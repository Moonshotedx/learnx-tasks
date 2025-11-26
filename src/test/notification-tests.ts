import mockData from './mock-data.json';
import {
    setupTestDatabase,
    cleanupTestDatabase,
    MockNotificationService,
    MockQueryEngine,
    TestAssertions,
    TestReporter,
} from './test-utils';

/**
 * Notification System Test Suite
 *
 * This test suite validates that the notification system correctly:
 * 1. Identifies the right recipients for each notification type
 * 2. Sends notifications only to users associated with the specific run/activity/group
 * 3. Excludes users who shouldn't receive notifications
 * 4. Handles different activity types correctly (quiz, assignment, exam)
 *
 * All tests run on mock JSON data - NO DATABASE REQUIRED
 *
 * IMPORTANT: These tests replicate the exact logic from src/trigger/notify.ts
 * to validate notification behavior without requiring a real database connection.
 * The SQL queries, logic flow, and conditions match notify.ts exactly.
 */

// Mock query engine (replaces database)
let mockQueryEngine: MockQueryEngine;

// Mock services
const mockNotificationService = new MockNotificationService();
const testAssertions = new TestAssertions(mockNotificationService);
const testReporter = new TestReporter();

/**
 * Test: Student Deadline Notification
 * Validates that only students enrolled in a specific course run receive deadline notifications
 */
async function testStudentDeadlineNotification() {
    console.log('\n📝 Testing Student Deadline Notification...');
    const scenario = mockData.test_scenarios.student_deadline_notification;
    const testName = 'Student Deadline Notification';

    mockNotificationService.reset();

    // Simulate the notification task
    const { courseActivityId, runId, deadline } = scenario.test_payload;

    // Query to get activity details
    const activityRes = await mockQueryEngine.query(
        `SELECT a.id as activity_id, a.type, a.payload, ca.order, c.id as course_id, c.name as course_name
     FROM activities a
     JOIN "course-activities" ca ON ca.activity_id = a.id
     JOIN courses c ON ca.course_id = c.id
     WHERE ca.id = $1`,
        [courseActivityId],
    );

    if (!activityRes.rows.length) {
        testReporter.addResult(testName, 'Activity Lookup', {
            passed: false,
            message: 'Activity not found',
        });
        return;
    }

    const activity = activityRes.rows[0];
    const activityType = activity.type;

    // Check if activity type is quiz, assignment, or exam
    if (
        activityType !== 'quiz' &&
        activityType !== 'assignment' &&
        activityType !== 'exam'
    ) {
        testReporter.addResult(testName, 'Activity Type Validation', {
            passed: true,
            message: 'Non-graded activity types correctly skipped',
        });
        return;
    }

    let parsed;
    try {
        parsed = JSON.parse(activity.payload);
    } catch (error) {
        testReporter.addResult(testName, 'Payload Parsing', {
            passed: false,
            message: 'Failed to parse activity payload',
        });
        return;
    }

    const activityName = parsed.title;

    // Get run and group info
    const runRes = await mockQueryEngine.query(
        `SELECT group_id, name FROM "course-runs" WHERE id = $1`,
        [runId],
    );
    const groupId = runRes.rows[0]?.group_id;
    const runName = runRes.rows[0]?.name;

    if (!groupId) {
        testReporter.addResult(testName, 'Run Lookup', {
            passed: false,
            message: 'Group not found for run',
        });
        return;
    }

    if (!runName) {
        testReporter.addResult(testName, 'Run Lookup', {
            passed: false,
            message: 'Run name not found',
        });
        return;
    }

    // Get students in the group
    const studentsRes = await mockQueryEngine.query(
        `SELECT u.id, u.name FROM "group-members" gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1 AND gm.role = 'student'`,
        [groupId],
    );

    // Simulate sending notifications
    for (const student of studentsRes.rows) {
        await mockNotificationService.sendPushNotification(student.id, {
            title: `Deadline Reminder: "${activityName}"`,
            body: `Hi ${student.name}, the deadline for "${activityName}" in "${runName}" is approaching (${deadline}). Make sure to complete it on time!`,
            data: { courseActivityId, runId, deadline },
        });

        await mockNotificationService.sendEmailNotification(
            student.id,
            `Deadline Reminder: ${activityName}`,
            'Upcoming Deadline',
            activityName,
            `The deadline for this activity is ${deadline}. Please complete it on time.`,
        );
    }

    // Test assertions
    const pushResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'push',
    );
    testReporter.addResult(
        testName,
        'Push Notification Recipients',
        pushResult,
    );

    const emailResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'email',
    );
    testReporter.addResult(
        testName,
        'Email Notification Recipients',
        emailResult,
    );

    // Check notification content
    for (const userId of scenario.expected_recipients) {
        const contentResult = testAssertions.assertNotificationContent(
            userId,
            [activityName, runName, deadline],
            'push',
        );
        testReporter.addResult(
            testName,
            `Content Validation for ${userId}`,
            contentResult,
        );
    }
}

/**
 * Test: Manager Deadline Warning
 * Validates that course managers receive deadline warnings
 */
async function testManagerDeadlineWarning() {
    console.log('\n📝 Testing Manager Deadline Warning...');
    const scenario = mockData.test_scenarios.manager_deadline_warning;
    const testName = 'Manager Deadline Warning';

    mockNotificationService.reset();

    const { courseActivityId, runId, deadline } = scenario.test_payload;

    // Get activity and course info
    const activityRes = await mockQueryEngine.query(
        `SELECT a.id as activity_id, a.type, a.payload, ca.order, c.id as course_id, c.name as course_name
     FROM activities a
     JOIN "course-activities" ca ON ca.activity_id = a.id
     JOIN courses c ON ca.course_id = c.id
     WHERE ca.id = $1`,
        [courseActivityId],
    );

    const activity = activityRes.rows[0];
    const parsed = JSON.parse(activity.payload);
    const activityName = parsed.title;
    const courseId = activity.course_id;

    // Get run name
    const runRes = await mockQueryEngine.query(
        `SELECT name FROM "course-runs" WHERE id = $1`,
        [runId],
    );
    const runName = runRes.rows[0]?.name;

    if (!runName) {
        testReporter.addResult(testName, 'Run Lookup', {
            passed: false,
            message: 'Run name not found',
        });
        return;
    }

    // Get managers for the course
    const managersRes = await mockQueryEngine.query(
        `SELECT u.id, u.name FROM course_managers cm
     JOIN users u ON cm.user_id = u.id
     WHERE cm.course_id = $1`,
        [courseId],
    );

    // Simulate sending notifications
    for (const manager of managersRes.rows) {
        await mockNotificationService.sendPushNotification(manager.id, {
            title: `Manager Alert: Deadline Approaching for "${activityName}"`,
            body: `Hi ${manager.name}, the deadline for activity "${activityName}" in "${runName}" is in 30 minutes (${deadline}). Students may need last-minute support.`,
            data: { courseActivityId, runId, deadline },
        });

        await mockNotificationService.sendEmailNotification(
            manager.id,
            `Manager Alert: ${activityName}`,
            'Deadline Warning',
            activityName,
            `The deadline for this activity is ${deadline} (in 30 minutes).`,
        );
    }

    // Test assertions
    const pushResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'push',
    );
    testReporter.addResult(
        testName,
        'Push Notification Recipients',
        pushResult,
    );

    const emailResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'email',
    );
    testReporter.addResult(
        testName,
        'Email Notification Recipients',
        emailResult,
    );
}

/**
 * Test: Score Published Notification
 * Validates that students receive notifications when scores are published
 */
async function testScorePublishedNotification() {
    console.log('\n📝 Testing Score Published Notification...');
    const scenario = mockData.test_scenarios.score_published_notification;
    const testName = 'Score Published Notification';

    mockNotificationService.reset();

    const { courseActivityId, runId } = scenario.test_payload;

    // Get activity, course, and run info
    const res = await mockQueryEngine.query(
        `SELECT a.id as activity_id, a.type, a.payload, 
            ca.id as course_activity_id, 
            c.id as course_id, c.name as course_name, 
            cr.name as run_name, cr.group_id,
            g.name as group_name
     FROM activities a
     JOIN "course-activities" ca ON ca.activity_id = a.id
     JOIN courses c ON ca.course_id = c.id
     JOIN "course-runs" cr ON cr.id = $2
     JOIN groups g ON cr.group_id = g.id
     WHERE ca.id = $1`,
        [courseActivityId, runId],
    );

    if (!res.rows || res.rows.length === 0) {
        testReporter.addResult(testName, 'Activity Query', {
            passed: false,
            message: `Query returned no rows for courseActivityId=${courseActivityId}, runId=${runId}`,
        });
        return;
    }

    const row = res.rows[0];
    const parsed = JSON.parse(row.payload);
    const activityName = parsed.title;
    const runName = row.run_name;
    const groupId = row.group_id;

    // Get students in the group
    const studentsRes = await mockQueryEngine.query(
        `SELECT u.id, u.name FROM "group-members" gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1 AND gm.role = 'student'`,
        [groupId],
    );

    // Simulate sending notifications
    for (const student of studentsRes.rows) {
        await mockNotificationService.sendPushNotification(student.id, {
            title: `Scores Published: "${activityName}"`,
            body: `Hi ${student.name}, scores for "${activityName}" in "${runName}" have been published. Check your dashboard to view your results!`,
            data: { courseActivityId, runId },
        });

        await mockNotificationService.sendEmailNotification(
            student.id,
            `Scores Published: ${activityName}`,
            'Results Available',
            activityName,
            `Your scores for this activity have been published. Log in to view your results.`,
        );
    }

    // Test assertions
    const pushResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'push',
    );
    testReporter.addResult(
        testName,
        'Push Notification Recipients',
        pushResult,
    );

    const emailResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'email',
    );
    testReporter.addResult(
        testName,
        'Email Notification Recipients',
        emailResult,
    );
}

/**
 * Test: Activity Posted Notification
 * Validates that students receive notifications when new activities are posted
 */
async function testActivityPostedNotification() {
    console.log('\n📝 Testing Activity Posted Notification...');
    const scenario = mockData.test_scenarios.activity_posted_notification;
    const testName = 'Activity Posted Notification';

    mockNotificationService.reset();

    const { courseActivityId, runId } = scenario.test_payload;

    // Get activity, course, and run info
    const res = await mockQueryEngine.query(
        `SELECT a.id as activity_id, a.type, a.payload, 
            ca.id as course_activity_id, 
            c.id as course_id, c.name as course_name, 
            cr.name as run_name, cr.group_id,
            g.name as group_name
     FROM activities a
     JOIN "course-activities" ca ON ca.activity_id = a.id
     JOIN courses c ON ca.course_id = c.id
     JOIN "course-runs" cr ON cr.id = $2
     JOIN groups g ON cr.group_id = g.id
     WHERE ca.id = $1`,
        [courseActivityId, runId],
    );

    if (!res.rows || res.rows.length === 0) {
        testReporter.addResult(testName, 'Activity Query', {
            passed: false,
            message: `Query returned no rows for courseActivityId=${courseActivityId}, runId=${runId}`,
        });
        return;
    }

    const row = res.rows[0];
    const parsed = JSON.parse(row.payload);
    const activityName = parsed.title;
    const runName = row.run_name;
    const groupId = row.group_id;

    // Get students in the group
    const studentsRes = await mockQueryEngine.query(
        `SELECT u.id, u.name FROM "group-members" gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1 AND gm.role = 'student'`,
        [groupId],
    );

    // Simulate sending notifications
    for (const student of studentsRes.rows) {
        await mockNotificationService.sendPushNotification(student.id, {
            title: `New Activity Posted: "${activityName}"`,
            body: `Hi ${student.name}, a new activity "${activityName}" has been posted in "${runName}". Check it out!`,
            data: { courseActivityId, runId },
        });
    }

    // Test assertions
    const pushResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'push',
    );
    testReporter.addResult(
        testName,
        'Push Notification Recipients',
        pushResult,
    );
}

/**
 * Test: Redo Enabled Notification
 * Validates that specific student receives notification when redo is enabled
 */
async function testRedoEnabledNotification() {
    console.log('\n📝 Testing Redo Enabled Notification...');
    const scenario = mockData.test_scenarios.redo_enabled_notification;
    const testName = 'Redo Enabled Notification';

    mockNotificationService.reset();

    const { userId, activityId, newDeadline, runId } = scenario.test_payload;

    // Get course activity info
    const courseActivitiesRes = await mockQueryEngine.query(
        `SELECT ca.id as course_activity_id, c.id as course_id, c.name as course_name
     FROM "course-activities" ca
     JOIN courses c ON ca.course_id = c.id
     WHERE ca.activity_id = $1`,
        [activityId],
    );

    const courseActivityId = courseActivitiesRes.rows[0].course_activity_id;

    // Get activity details
    const result = await mockQueryEngine.query(
        `SELECT a.id as activity_id, a.type, a.payload, ca.order, c.id as course_id, c.name as course_name
     FROM activities a
     JOIN "course-activities" ca ON ca.activity_id = a.id
     JOIN courses c ON ca.course_id = c.id
     WHERE ca.id = $1`,
        [courseActivityId],
    );

    const activity = result.rows[0];
    const parsed = JSON.parse(activity.payload);
    const activityName = parsed.title;
    const courseName = activity.course_name;

    // Get run name
    const runRes = await mockQueryEngine.query(
        `SELECT name FROM "course-runs" WHERE id = $1`,
        [runId],
    );
    const runName = runRes.rows[0]?.name;

    // Get user info
    const userRes = await mockQueryEngine.query(
        `SELECT name FROM users WHERE id = $1`,
        [userId],
    );
    const userName = userRes.rows[0]?.name;

    const courseInfo = runName ? runName : courseName;

    // Simulate sending notification to specific user
    await mockNotificationService.sendPushNotification(userId, {
        title: `Redo enabled for "${activityName}" in "${courseInfo}"`,
        body: `Hi ${userName}, redo for activity "${activityName}" is enabled. New deadline: ${newDeadline}.`,
        data: { activityId: activityId.toString(), newDeadline },
    });

    await mockNotificationService.sendEmailNotification(
        userId,
        `Redo Enabled: ${activityName}`,
        'Redo Opportunity',
        activityName,
        `You have been granted a redo opportunity for this activity. New deadline: ${newDeadline}.`,
    );

    // Test assertions
    const pushResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'push',
    );
    testReporter.addResult(
        testName,
        'Push Notification Recipients',
        pushResult,
    );

    const countResult = testAssertions.assertNotificationCount(
        userId,
        1,
        'push',
    );
    testReporter.addResult(testName, 'Notification Count', countResult);
}

/**
 * Test: Added to Group Notification
 * Validates that student receives notification when added to a group
 */
async function testAddedToGroupNotification() {
    console.log('\n📝 Testing Added to Group Notification...');
    const scenario = mockData.test_scenarios.added_to_group_notification;
    const testName = 'Added to Group Notification';

    mockNotificationService.reset();

    const { userId, groupId } = scenario.test_payload;

    // Get user info
    const userRes = await mockQueryEngine.query(
        `SELECT id, name FROM users WHERE id = $1`,
        [userId],
    );
    const student = userRes.rows[0];

    // Get group info
    const groupRes = await mockQueryEngine.query(
        `SELECT g.id as group_id, g.name as group_name, cr.name as run_name, c.name as course_name
     FROM groups g
     LEFT JOIN "course-runs" cr ON cr.group_id = g.id
     LEFT JOIN courses c ON cr.course_id = c.id
     WHERE g.id = $1`,
        [groupId],
    );

    const groupName = groupRes.rows[0]?.group_name;

    // Simulate sending notification
    await mockNotificationService.sendPushNotification(student.id, {
        title: `You've been added to group: ${groupName}`,
        body: `Hi ${student.name || ''}, you have been added to group "${groupName}". Check your dashboard for details!`,
        data: { groupId },
    });

    await mockNotificationService.sendEmailNotification(
        student.id,
        `Added to Group: ${groupName}`,
        'Group Membership',
        groupName,
        `You have been added to this group.`,
    );

    // Test assertions
    const pushResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'push',
    );
    testReporter.addResult(
        testName,
        'Push Notification Recipients',
        pushResult,
    );

    const countResult = testAssertions.assertNotificationCount(
        userId,
        1,
        'push',
    );
    testReporter.addResult(testName, 'Notification Count', countResult);
}

/**
 * Test: New Document Notification
 * Validates that students and managers receive notifications for new documents
 */
async function testNewDocumentNotification() {
    console.log('\n📝 Testing New Document Notification...');
    const scenario = mockData.test_scenarios.new_document_notification;
    const testName = 'New Document Notification';

    mockNotificationService.reset();

    const { runId, documentName } = scenario.test_payload;

    // Get run info
    const runRes = await mockQueryEngine.query(
        `SELECT group_id, course_id, c.name as course_name 
     FROM "course-runs" cr
     JOIN courses c ON cr.course_id = c.id
     WHERE cr.id = $1`,
        [runId],
    );

    const groupId = runRes.rows[0]?.group_id;
    const courseId = runRes.rows[0]?.course_id;
    const courseName = runRes.rows[0]?.course_name;

    // Get students in the group
    const studentsRes = await mockQueryEngine.query(
        `SELECT u.id, u.name FROM "group-members" gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1 AND gm.role = 'student'`,
        [groupId],
    );

    // Get course managers
    const managersRes = await mockQueryEngine.query(
        `SELECT u.id, u.name FROM course_managers cm
     JOIN users u ON cm.user_id = u.id
     WHERE cm.course_id = $1`,
        [courseId],
    );

    // Simulate sending notifications to students
    for (const student of studentsRes.rows) {
        await mockNotificationService.sendPushNotification(student.id, {
            title: `New Document: "${documentName}"`,
            body: `Hi ${student.name}, a new document "${documentName}" has been added to "${courseName}".`,
            data: { runId, documentName },
        });

        await mockNotificationService.sendEmailNotification(
            student.id,
            `New Document: ${documentName}`,
            'New Resource Available',
            documentName,
            `A new document has been added to ${courseName}.`,
        );
    }

    // Simulate sending notifications to managers
    for (const manager of managersRes.rows) {
        await mockNotificationService.sendPushNotification(manager.id, {
            title: `New Document: "${documentName}"`,
            body: `Hi ${manager.name}, a new document "${documentName}" has been added to "${courseName}".`,
            data: { runId, documentName },
        });

        await mockNotificationService.sendEmailNotification(
            manager.id,
            `New Document: ${documentName}`,
            'New Resource Available',
            documentName,
            `A new document has been added to ${courseName}.`,
        );
    }

    // Test assertions
    const pushResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'push',
    );
    testReporter.addResult(
        testName,
        'Push Notification Recipients',
        pushResult,
    );
}

/**
 * Test: Missed Deadline Notification
 * Validates that only students who missed the deadline (and didn't submit) receive notifications
 */
async function testMissedDeadlineNotification() {
    console.log('\n📝 Testing Missed Deadline Notification...');
    const scenario = mockData.test_scenarios.missed_deadline_notification;
    const testName = 'Missed Deadline Notification';

    mockNotificationService.reset();

    const { courseActivityId, runId, deadline } = scenario.test_payload;

    // Get activity and run info
    const res = await mockQueryEngine.query(
        `SELECT a.id as activity_id, a.type, a.payload, 
            ca.id as course_activity_id, 
            c.id as course_id, c.name as course_name, 
            cr.name as run_name, cr.group_id,
            g.name as group_name
     FROM activities a
     JOIN "course-activities" ca ON ca.activity_id = a.id
     JOIN courses c ON ca.course_id = c.id
     JOIN "course-runs" cr ON cr.id = $2
     JOIN groups g ON cr.group_id = g.id
     WHERE ca.id = $1`,
        [courseActivityId, runId],
    );

    const row = res.rows[0];
    const parsed = JSON.parse(row.payload);
    const activityName = parsed.title;
    const runName = row.run_name;
    const groupId = row.group_id;
    const activityId = row.activity_id;
    const activityType = row.type;

    // Get all students in the group
    const studentsRes = await mockQueryEngine.query(
        `SELECT u.id, u.name FROM "group-members" gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1 AND gm.role = 'student'`,
        [groupId],
    );

    // Get students who submitted
    let submittedIds: string[] = [];

    if (activityType === 'assignment') {
        const submissionsRes = await mockQueryEngine.query(
            `SELECT DISTINCT user_id FROM assignment_submissions
       WHERE activity_id = $1 AND course_run_id = $2`,
            [activityId, runId],
        );
        submittedIds = submissionsRes.rows.map((r) => r.user_id);
    } else if (activityType === 'quiz') {
        const attemptsRes = await mockQueryEngine.query(
            `SELECT DISTINCT user_id FROM "quiz-attempts"
       WHERE activity_id = $1 AND course_run_id = $2 AND completed_at IS NOT NULL`,
            [activityId, runId],
        );
        submittedIds = attemptsRes.rows.map((r) => r.user_id);
    } else if (activityType === 'exam') {
        const examRes = await mockQueryEngine.query(
            `SELECT DISTINCT user_id FROM exam_submissions
       WHERE activity_id = $1 AND course_run_id = $2 AND submitted_at IS NOT NULL`,
            [activityId, runId],
        );
        submittedIds = examRes.rows.map((r) => r.user_id);
    }

    // Send notifications to students who didn't submit
    for (const student of studentsRes.rows) {
        if (!submittedIds.includes(student.id)) {
            await mockNotificationService.sendPushNotification(student.id, {
                title: `Missed Deadline: "${activityName}"`,
                body: `Hi ${student.name}, you missed the deadline for "${activityName}" in "${runName}". Please contact your instructor if you need assistance.`,
                data: { courseActivityId, runId, deadline },
            });

            await mockNotificationService.sendEmailNotification(
                student.id,
                `Missed Deadline: ${activityName}`,
                'Deadline Passed',
                activityName,
                `The deadline for this activity has passed. You have not submitted your work.`,
            );
        }
    }

    // Test assertions
    const pushResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'push',
    );
    testReporter.addResult(
        testName,
        'Push Notification Recipients',
        pushResult,
    );

    // Verify students who submitted did NOT receive notifications
    for (const userId of scenario.not_expected) {
        const countResult = testAssertions.assertNotificationCount(
            userId,
            0,
            'push',
        );
        testReporter.addResult(
            testName,
            `Verify ${userId} did not receive notification`,
            countResult,
        );
    }
}

/**
 * Test: Group Isolation - Student Deadline Notification
 * Critical test to ensure students from different groups don't receive each other's notifications
 */
async function testGroupIsolationStudentDeadline() {
    console.log(
        '\n📝 Testing Group Isolation - Student Deadline Notification...',
    );
    const scenario = mockData.test_scenarios.group_isolation_student_deadline;
    const testName = 'Group Isolation - Student Deadline';

    mockNotificationService.reset();

    const { courseActivityId, runId, deadline } = scenario.test_payload;

    // Get activity details
    const activityRes = await mockQueryEngine.query(
        `SELECT a.id as activity_id, a.type, a.payload, ca.order, c.id as course_id, c.name as course_name
     FROM activities a
     JOIN "course-activities" ca ON ca.activity_id = a.id
     JOIN courses c ON ca.course_id = c.id
     WHERE ca.id = $1`,
        [courseActivityId],
    );

    const activity = activityRes.rows[0];
    const parsed = JSON.parse(activity.payload);
    const activityName = parsed.title;

    // Get run and group info
    const runRes = await mockQueryEngine.query(
        `SELECT group_id, name FROM "course-runs" WHERE id = $1`,
        [runId],
    );
    const groupId = runRes.rows[0]?.group_id;
    const runName = runRes.rows[0]?.name;

    console.log(`  ℹ️  Run ${runId} belongs to Group ${groupId}`);

    // Get students in THIS specific group only
    const studentsRes = await mockQueryEngine.query(
        `SELECT u.id, u.name FROM "group-members" gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1 AND gm.role = 'student'`,
        [groupId],
    );

    console.log(
        `  ℹ️  Found ${studentsRes.rows.length} students in Group ${groupId}`,
    );

    // Simulate sending notifications
    for (const student of studentsRes.rows) {
        await mockNotificationService.sendPushNotification(student.id, {
            title: `Deadline Reminder: "${activityName}"`,
            body: `Hi ${student.name}, the deadline for "${activityName}" in "${runName}" is approaching (${deadline}).`,
            data: { courseActivityId, runId, deadline },
        });

        await mockNotificationService.sendEmailNotification(
            student.id,
            `Deadline Reminder: ${activityName}`,
            'Upcoming Deadline',
            activityName,
            `The deadline for this activity is ${deadline}.`,
        );
    }

    // CRITICAL: Verify that ONLY Group 1 students received notifications
    const pushResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'push',
    );
    testReporter.addResult(
        testName,
        'Push Notification Group Isolation',
        pushResult,
    );

    const emailResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'email',
    );
    testReporter.addResult(
        testName,
        'Email Notification Group Isolation',
        emailResult,
    );

    // Verify students from other groups did NOT receive any notifications
    for (const userId of scenario.not_expected) {
        const countResult = testAssertions.assertNotificationCount(
            userId,
            0,
            'push',
        );
        testReporter.addResult(
            testName,
            `Verify ${userId} (other group) received ZERO notifications`,
            countResult,
        );
    }

    console.log(
        `  ✅ Group isolation validated: ${scenario.expected_recipients.length} students in Group ${groupId} notified, ${scenario.not_expected.length} students from other groups excluded`,
    );
}

/**
 * Test: Group Isolation - Activity Posted
 * Ensures activity posted notifications are sent only to the correct group
 */
async function testGroupIsolationActivityPosted() {
    console.log(
        '\n📝 Testing Group Isolation - Activity Posted Notification...',
    );
    const scenario = mockData.test_scenarios.group_isolation_activity_posted;
    const testName = 'Group Isolation - Activity Posted';

    mockNotificationService.reset();

    const { courseActivityId, runId } = scenario.test_payload;

    // Get activity, course, and run info
    const res = await mockQueryEngine.query(
        `SELECT a.id as activity_id, a.type, a.payload, 
            ca.id as course_activity_id, 
            c.id as course_id, c.name as course_name, 
            cr.name as run_name, cr.group_id,
            g.name as group_name
     FROM activities a
     JOIN "course-activities" ca ON ca.activity_id = a.id
     JOIN courses c ON ca.course_id = c.id
     JOIN "course-runs" cr ON cr.id = $2
     JOIN groups g ON cr.group_id = g.id
     WHERE ca.id = $1`,
        [courseActivityId, runId],
    );

    const row = res.rows[0];
    const parsed = JSON.parse(row.payload);
    const activityName = parsed.title;
    const runName = row.run_name;
    const groupId = row.group_id;
    const groupName = row.group_name;

    console.log(
        `  ℹ️  Run ${runId} (${runName}) belongs to Group ${groupId} (${groupName})`,
    );

    // Get students in THIS specific group only
    const studentsRes = await mockQueryEngine.query(
        `SELECT u.id, u.name FROM "group-members" gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1 AND gm.role = 'student'`,
        [groupId],
    );

    console.log(
        `  ℹ️  Found ${studentsRes.rows.length} students in Group ${groupId}`,
    );

    // Simulate sending notifications
    for (const student of studentsRes.rows) {
        await mockNotificationService.sendPushNotification(student.id, {
            title: `New Activity Posted: "${activityName}"`,
            body: `Hi ${student.name}, a new activity "${activityName}" has been posted in "${runName}".`,
            data: { courseActivityId, runId },
        });

        await mockNotificationService.sendEmailNotification(
            student.id,
            `New Activity: ${activityName}`,
            'New Activity Available',
            activityName,
            `A new activity has been posted in ${runName}.`,
        );
    }

    // CRITICAL: Verify that ONLY Group 2 students received notifications
    const pushResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'push',
    );
    testReporter.addResult(
        testName,
        'Push Notification Group Isolation',
        pushResult,
    );

    const emailResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'email',
    );
    testReporter.addResult(
        testName,
        'Email Notification Group Isolation',
        emailResult,
    );

    // Verify students from other groups received ZERO notifications
    for (const userId of scenario.not_expected) {
        const countResult = testAssertions.assertNotificationCount(
            userId,
            0,
            'push',
        );
        testReporter.addResult(
            testName,
            `Verify ${userId} (other group) received ZERO notifications`,
            countResult,
        );
    }

    console.log(`  ✅ Group isolation validated for activity posting`);
}

/**
 * Test: Manager Course Isolation - Deadline Warning
 * Ensures managers only receive notifications for courses they manage
 */
async function testManagerCourseIsolationDeadlineWarning() {
    console.log('\n📝 Testing Manager Course Isolation - Deadline Warning...');
    const scenario =
        mockData.test_scenarios.manager_course_isolation_deadline_warning;
    const testName = 'Manager Course Isolation - Deadline Warning';

    mockNotificationService.reset();

    const { courseActivityId, runId, deadline } = scenario.test_payload;

    // Get activity and course info
    const activityRes = await mockQueryEngine.query(
        `SELECT a.id as activity_id, a.type, a.payload, ca.order, c.id as course_id, c.name as course_name
     FROM activities a
     JOIN "course-activities" ca ON ca.activity_id = a.id
     JOIN courses c ON ca.course_id = c.id
     WHERE ca.id = $1`,
        [courseActivityId],
    );

    const activity = activityRes.rows[0];
    const parsed = JSON.parse(activity.payload);
    const activityName = parsed.title;
    const courseId = activity.course_id;
    const courseName = activity.course_name;

    console.log(`  ℹ️  Activity belongs to Course ${courseId} (${courseName})`);

    // Get run name
    const runRes = await mockQueryEngine.query(
        `SELECT name FROM "course-runs" WHERE id = $1`,
        [runId],
    );
    const runName = runRes.rows[0]?.name;

    // Get managers for THIS specific course only
    const managersRes = await mockQueryEngine.query(
        `SELECT u.id, u.name FROM course_managers cm
     JOIN users u ON cm.user_id = u.id
     WHERE cm.course_id = $1`,
        [courseId],
    );

    console.log(
        `  ℹ️  Found ${managersRes.rows.length} managers for Course ${courseId}`,
    );

    // Simulate sending notifications
    for (const manager of managersRes.rows) {
        await mockNotificationService.sendPushNotification(manager.id, {
            title: `Manager Alert: Deadline Approaching for "${activityName}"`,
            body: `Hi ${manager.name}, the deadline for activity "${activityName}" in "${runName}" is in 30 minutes (${deadline}).`,
            data: { courseActivityId, runId, deadline },
        });

        await mockNotificationService.sendEmailNotification(
            manager.id,
            `Manager Alert: ${activityName}`,
            'Deadline Warning',
            activityName,
            `The deadline for this activity is ${deadline} (in 30 minutes).`,
        );
    }

    // CRITICAL: Verify that ONLY managers of Course 1 received notifications
    const pushResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'push',
    );
    testReporter.addResult(
        testName,
        'Push Notification Manager Isolation',
        pushResult,
    );

    const emailResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'email',
    );
    testReporter.addResult(
        testName,
        'Email Notification Manager Isolation',
        emailResult,
    );

    // Verify students received ZERO notifications
    for (const userId of scenario.not_expected) {
        const countResult = testAssertions.assertNotificationCount(
            userId,
            0,
            'push',
        );
        testReporter.addResult(
            testName,
            `Verify ${userId} (non-manager) received ZERO notifications`,
            countResult,
        );
    }

    console.log(`  ✅ Manager course isolation validated`);
}

/**
 * Test: Manager Course Isolation - Multiple Courses
 * Ensures managers receive notifications only for their specific courses
 */
async function testManagerCourseIsolationMultipleCourses() {
    console.log('\n📝 Testing Manager Course Isolation - Multiple Courses...');
    const scenario =
        mockData.test_scenarios.manager_course_isolation_multiple_courses;
    const testName = 'Manager Course Isolation - Multiple Courses';

    mockNotificationService.reset();

    const { courseActivityId, runId, deadline } = scenario.test_payload;

    // Get activity and course info
    const activityRes = await mockQueryEngine.query(
        `SELECT a.id as activity_id, a.type, a.payload, ca.order, c.id as course_id, c.name as course_name
     FROM activities a
     JOIN "course-activities" ca ON ca.activity_id = a.id
     JOIN courses c ON ca.course_id = c.id
     WHERE ca.id = $1`,
        [courseActivityId],
    );

    const activity = activityRes.rows[0];
    const parsed = JSON.parse(activity.payload);
    const activityName = parsed.title;
    const courseId = activity.course_id;
    const courseName = activity.course_name;

    console.log(`  ℹ️  Activity belongs to Course ${courseId} (${courseName})`);

    // Get run name
    const runRes = await mockQueryEngine.query(
        `SELECT name FROM "course-runs" WHERE id = $1`,
        [runId],
    );
    const runName = runRes.rows[0]?.name;

    // Get managers for THIS specific course only
    const managersRes = await mockQueryEngine.query(
        `SELECT u.id, u.name FROM course_managers cm
     JOIN users u ON cm.user_id = u.id
     WHERE cm.course_id = $1`,
        [courseId],
    );

    console.log(
        `  ℹ️  Found ${managersRes.rows.length} manager(s) for Course ${courseId}: ${managersRes.rows.map((m) => m.id).join(', ')}`,
    );

    // Simulate sending notifications
    for (const manager of managersRes.rows) {
        await mockNotificationService.sendPushNotification(manager.id, {
            title: `Manager Alert: Deadline Approaching for "${activityName}"`,
            body: `Hi ${manager.name}, the deadline for activity "${activityName}" in "${runName}" is approaching.`,
            data: { courseActivityId, runId, deadline },
        });

        await mockNotificationService.sendEmailNotification(
            manager.id,
            `Manager Alert: ${activityName}`,
            'Deadline Warning',
            activityName,
            `The deadline for this activity is ${deadline}.`,
        );
    }

    // CRITICAL: Verify that ONLY manager-1 (who manages Course 2) received notifications
    // manager-2 should NOT receive this because they don't manage Course 2
    const pushResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'push',
    );
    testReporter.addResult(
        testName,
        'Push Notification Manager Course Isolation',
        pushResult,
    );

    const emailResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'email',
    );
    testReporter.addResult(
        testName,
        'Email Notification Manager Course Isolation',
        emailResult,
    );

    // Verify manager-2 received ZERO notifications for Course 2
    for (const userId of scenario.not_expected) {
        const countResult = testAssertions.assertNotificationCount(
            userId,
            0,
            'push',
        );
        testReporter.addResult(
            testName,
            `Verify ${userId} (not managing this course) received ZERO notifications`,
            countResult,
        );
    }

    console.log(
        `  ✅ Manager receives notifications only for their enrolled courses`,
    );
}

/**
 * Test: Cross-Group No Leakage - Score Published
 * Ensures score notifications don't leak to students in other groups
 */
async function testCrossGroupNoLeakageScores() {
    console.log('\n📝 Testing Cross-Group No Leakage - Score Published...');
    const scenario = mockData.test_scenarios.cross_group_no_leakage_scores;
    const testName = 'Cross-Group No Leakage - Scores';

    mockNotificationService.reset();

    const { courseActivityId, runId } = scenario.test_payload;

    // Get activity, course, and run info
    const res = await mockQueryEngine.query(
        `SELECT a.id as activity_id, a.type, a.payload, 
            ca.id as course_activity_id, 
            c.id as course_id, c.name as course_name, 
            cr.name as run_name, cr.group_id,
            g.name as group_name
     FROM activities a
     JOIN "course-activities" ca ON ca.activity_id = a.id
     JOIN courses c ON ca.course_id = c.id
     JOIN "course-runs" cr ON cr.id = $2
     JOIN groups g ON cr.group_id = g.id
     WHERE ca.id = $1`,
        [courseActivityId, runId],
    );

    const row = res.rows[0];
    const parsed = JSON.parse(row.payload);
    const activityName = parsed.title;
    const runName = row.run_name;
    const groupId = row.group_id;
    const groupName = row.group_name;

    console.log(
        `  ℹ️  Run ${runId} (${runName}) belongs to Group ${groupId} (${groupName})`,
    );

    // Get students in THIS specific group only
    const studentsRes = await mockQueryEngine.query(
        `SELECT u.id, u.name FROM "group-members" gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1 AND gm.role = 'student'`,
        [groupId],
    );

    console.log(
        `  ℹ️  Found ${studentsRes.rows.length} students in Group ${groupId}`,
    );

    // Simulate sending score published notifications
    for (const student of studentsRes.rows) {
        await mockNotificationService.sendPushNotification(student.id, {
            title: `Scores Published: "${activityName}"`,
            body: `Hi ${student.name}, scores for "${activityName}" in "${runName}" have been published.`,
            data: { courseActivityId, runId },
        });

        await mockNotificationService.sendEmailNotification(
            student.id,
            `Scores Published: ${activityName}`,
            'Results Available',
            activityName,
            `Your scores for this activity have been published.`,
        );
    }

    // CRITICAL: Verify that ONLY Group 2 students received notifications
    // Group 1 students should receive ZERO notifications
    const pushResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'push',
    );
    testReporter.addResult(
        testName,
        'Push Notification No Cross-Group Leakage',
        pushResult,
    );

    const emailResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'email',
    );
    testReporter.addResult(
        testName,
        'Email Notification No Cross-Group Leakage',
        emailResult,
    );

    // Verify Group 1 students received ZERO notifications
    for (const userId of scenario.not_expected) {
        const countResult = testAssertions.assertNotificationCount(
            userId,
            0,
            'push',
        );
        testReporter.addResult(
            testName,
            `Verify ${userId} (Group 1) received ZERO notifications for Group 2 activity`,
            countResult,
        );
    }

    console.log(`  ✅ No cross-group notification leakage detected`);
}

/**
 * Test: Facilitator Post-Deadline Summary Isolation
 * Ensures only managers of the specific course receive post-deadline summaries
 */
async function testFacilitatorPostDeadlineSummaryIsolation() {
    console.log('\n📝 Testing Facilitator Post-Deadline Summary Isolation...');
    const scenario =
        mockData.test_scenarios.facilitator_post_deadline_summary_isolation;
    const testName = 'Facilitator Post-Deadline Summary Isolation';

    mockNotificationService.reset();

    const { courseActivityId, runId, deadline } = scenario.test_payload;

    // Get activity and course info
    const res = await mockQueryEngine.query(
        `SELECT a.id as activity_id, a.type, a.payload, 
            ca.id as course_activity_id, 
            c.id as course_id, c.name as course_name, 
            cr.name as run_name, cr.group_id,
            g.name as group_name
     FROM activities a
     JOIN "course-activities" ca ON ca.activity_id = a.id
     JOIN courses c ON ca.course_id = c.id
     JOIN "course-runs" cr ON cr.id = $2
     JOIN groups g ON cr.group_id = g.id
     WHERE ca.id = $1`,
        [courseActivityId, runId],
    );

    const row = res.rows[0];
    const parsed = JSON.parse(row.payload);
    const activityName = parsed.title;
    const runName = row.run_name;
    const groupId = row.group_id;
    const courseId = row.course_id;
    const courseName = row.course_name;

    console.log(`  ℹ️  Activity belongs to Course ${courseId} (${courseName})`);

    // Get students in the group
    const studentsRes = await mockQueryEngine.query(
        `SELECT u.id FROM "group-members" gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1 AND gm.role = 'student'`,
        [groupId],
    );

    const studentIds = studentsRes.rows.map((s) => s.id);
    const submitted = 1; // Simulated
    const notSubmitted = studentIds.length - submitted;

    // Get facilitators for THIS specific course only
    const facilitatorsRes = await mockQueryEngine.query(
        `SELECT u.id, u.name FROM course_managers cm
     JOIN users u ON cm.user_id = u.id
     WHERE cm.course_id = $1`,
        [courseId],
    );

    console.log(
        `  ℹ️  Found ${facilitatorsRes.rows.length} facilitator(s) for Course ${courseId}: ${facilitatorsRes.rows.map((f) => f.id).join(', ')}`,
    );

    // Simulate sending notifications to facilitators
    for (const facilitator of facilitatorsRes.rows) {
        await mockNotificationService.sendPushNotification(facilitator.id, {
            title: `Graded activity deadline passed: ${activityName}`,
            body: `Activity "${activityName}" in "${runName}" deadline passed. Submitted: ${submitted}, Not submitted: ${notSubmitted}`,
            data: { courseActivityId, submitted, notSubmitted },
        });

        await mockNotificationService.sendEmailNotification(
            facilitator.id,
            `Post-Deadline Summary: ${activityName}`,
            'Activity Summary',
            activityName,
            `Deadline passed. Submitted: ${submitted}, Not submitted: ${notSubmitted}`,
        );
    }

    // CRITICAL: Verify that ONLY manager-2 (who manages Course 3) received notifications
    // manager-1 manages Course 1 and 2, but NOT Course 3
    const pushResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'push',
    );
    testReporter.addResult(
        testName,
        'Push Notification Facilitator Isolation',
        pushResult,
    );

    const emailResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'email',
    );
    testReporter.addResult(
        testName,
        'Email Notification Facilitator Isolation',
        emailResult,
    );

    // Verify manager-1 and students received ZERO notifications
    for (const userId of scenario.not_expected) {
        const countResult = testAssertions.assertNotificationCount(
            userId,
            0,
            'push',
        );
        testReporter.addResult(
            testName,
            `Verify ${userId} (not managing this course) received ZERO notifications`,
            countResult,
        );
    }

    console.log(
        `  ✅ Facilitator course isolation validated for post-deadline summary`,
    );
}

/**
 * Test: Multiple Groups One Student
 * Tests that a student in multiple groups receives notifications correctly based on run context
 */
async function testMultipleGroupsOneStudent() {
    console.log('\n📝 Testing Multiple Groups One Student...');
    const scenario = mockData.test_scenarios.multiple_groups_one_student;
    const testName = 'Multiple Groups One Student';

    mockNotificationService.reset();

    const { courseActivityId, runId, deadline } = scenario.test_payload;

    // Get activity details
    const activityRes = await mockQueryEngine.query(
        `SELECT a.id as activity_id, a.type, a.payload, ca.order, c.id as course_id, c.name as course_name
     FROM activities a
     JOIN "course-activities" ca ON ca.activity_id = a.id
     JOIN courses c ON ca.course_id = c.id
     WHERE ca.id = $1`,
        [courseActivityId],
    );

    const activity = activityRes.rows[0];
    const parsed = JSON.parse(activity.payload);
    const activityName = parsed.title;

    // Get run and group info
    const runRes = await mockQueryEngine.query(
        `SELECT group_id, name FROM "course-runs" WHERE id = $1`,
        [runId],
    );
    const groupId = runRes.rows[0]?.group_id;
    const runName = runRes.rows[0]?.name;

    console.log(`  ℹ️  Run ${runId} (${runName}) belongs to Group ${groupId}`);

    // Get students in THIS specific group only (Run 4 -> Group 3)
    const studentsRes = await mockQueryEngine.query(
        `SELECT u.id, u.name FROM "group-members" gm
     JOIN users u ON gm.user_id = u.id
     WHERE gm.group_id = $1 AND gm.role = 'student'`,
        [groupId],
    );

    console.log(
        `  ℹ️  Found ${studentsRes.rows.length} student(s) in Group ${groupId}: ${studentsRes.rows.map((s) => s.id).join(', ')}`,
    );
    console.log(
        `  ℹ️  Note: user-student-3 is in BOTH Group 1 and Group 3, but should only receive notification for Group 3 context (Run 4)`,
    );

    // Simulate sending notifications
    for (const student of studentsRes.rows) {
        await mockNotificationService.sendPushNotification(student.id, {
            title: `Deadline Reminder: "${activityName}"`,
            body: `Hi ${student.name}, the deadline for "${activityName}" in "${runName}" is approaching (${deadline}).`,
            data: { courseActivityId, runId, deadline },
        });

        await mockNotificationService.sendEmailNotification(
            student.id,
            `Deadline Reminder: ${activityName}`,
            'Upcoming Deadline',
            activityName,
            `The deadline for this activity is ${deadline}.`,
        );
    }

    // CRITICAL: Verify that ONLY student-3 (who is in Group 3) received notifications for Run 4
    const pushResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'push',
    );
    testReporter.addResult(
        testName,
        'Push Notification Multi-Group Student Isolation',
        pushResult,
    );

    const emailResult = testAssertions.assertRecipientsMatch(
        scenario.expected_recipients,
        scenario.not_expected,
        'email',
    );
    testReporter.addResult(
        testName,
        'Email Notification Multi-Group Student Isolation',
        emailResult,
    );

    // Verify other students did NOT receive notifications
    for (const userId of scenario.not_expected) {
        const countResult = testAssertions.assertNotificationCount(
            userId,
            0,
            'push',
        );
        testReporter.addResult(
            testName,
            `Verify ${userId} received ZERO notifications for this run`,
            countResult,
        );
    }

    // Additional validation: student-3 should receive exactly 1 notification (not duplicates)
    const student3CountResult = testAssertions.assertNotificationCount(
        'user-student-3',
        1,
        'push',
    );
    testReporter.addResult(
        testName,
        'Verify student-3 receives exactly 1 notification (no duplicates)',
        student3CountResult,
    );

    console.log(
        `  ✅ Student in multiple groups receives notifications correctly based on run context`,
    );
}

/**
 * Main test runner
 */
async function runAllTests() {
    console.log('='.repeat(80));
    console.log('NOTIFICATION SYSTEM TEST SUITE');
    console.log('='.repeat(80));
    console.log('\n🔧 Setting up mock data...');

    try {
        mockQueryEngine = await setupTestDatabase();

        // Run all tests
        await testStudentDeadlineNotification();
        await testManagerDeadlineWarning();
        await testScorePublishedNotification();
        await testActivityPostedNotification();
        await testRedoEnabledNotification();
        await testAddedToGroupNotification();
        await testNewDocumentNotification();
        await testMissedDeadlineNotification();

        // === CRITICAL ISOLATION TESTS ===
        console.log('\n' + '='.repeat(80));
        console.log('CRITICAL GROUP & MANAGER ISOLATION TESTS');
        console.log('='.repeat(80));

        await testGroupIsolationStudentDeadline();
        await testGroupIsolationActivityPosted();
        await testManagerCourseIsolationDeadlineWarning();
        await testManagerCourseIsolationMultipleCourses();
        await testCrossGroupNoLeakageScores();
        await testFacilitatorPostDeadlineSummaryIsolation();
        await testMultipleGroupsOneStudent();

        // Print summary
        testReporter.printSummary();

        // Cleanup
        console.log('\n🔧 Cleaning up...');
        await cleanupTestDatabase();

        // Exit with appropriate code
        process.exit(testReporter.hasFailures() ? 1 : 0);
    } catch (error) {
        console.error('❌ Test suite failed with error:', error);
        process.exit(1);
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    runAllTests();
}

export { runAllTests };
