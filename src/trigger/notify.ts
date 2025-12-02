import { task } from '@trigger.dev/sdk/v3';
import pool from '../lib/db';
import { emailTemplates } from '../lib/email-template';
import { NotificationService } from '../lib/notify-service';
import { convertUTCToISTString } from '../lib/utils';

export const scheduleStudentDeadlineNotification = task({
    id: 'schedule-student-deadline-notification',
    run: async (payload: {
        courseActivityId: number;
        runId: number;
        deadline: string;
    }) => {
        const activityRes = await pool.query(
            `SELECT a.type FROM "course-activities" ca
       JOIN activities a ON a.id = ca.activity_id
       WHERE ca.id = $1`,
            [payload.courseActivityId],
        );

        if (!activityRes.rowCount || activityRes.rowCount < 1) {
            throw new Error(
                `Activity not found for courseActivityId: ${payload.courseActivityId}`,
            );
        }

        const activityType = activityRes.rows[0].type;
        if (
            activityType !== 'quiz' &&
            activityType !== 'assignment' &&
            activityType !== 'exam'
        ) {
            console.log(
                `Skipping deadline notification scheduling for activity type: ${activityType}, courseActivityId: ${payload.courseActivityId}`,
            );
            return;
        }

        const formattedDeadlineIST = convertUTCToISTString(new Date(payload.deadline));

        await sendStudentDeadlineNotification.trigger(
            {
                courseActivityId: payload.courseActivityId,
                runId: payload.runId,
                deadline: formattedDeadlineIST,
            },
            {
                delay: payload.deadline,
                tags: [
                    `run_${payload.runId}`,
                    `activity_${payload.courseActivityId}`,
                    'student_deadline',
                ],
                metadata: {
                    runId: payload.runId,
                    courseActivityId: payload.courseActivityId,
                    deadline: payload.deadline,
                    formattedDeadlineIST: formattedDeadlineIST,
                    type: 'student_deadline_notification',
                },
            },
        );
    },
});

export const sendStudentDeadlineNotification = task({
    id: 'send-student-deadline-notification',
    run: async (payload: {
        courseActivityId: number;
        runId: number;
        deadline: string;
    }) => {
        const activityRes = await pool.query(
            `SELECT a.id as activity_id, a.type, a.payload, ca.order, c.id as course_id, c.name as course_name
       FROM "course-activities" ca
       JOIN activities a ON a.id = ca.activity_id
       JOIN courses c ON ca.course_id = c.id
       WHERE ca.id = $1`,
            [payload.courseActivityId],
        );
        const activity = activityRes.rows[0];

        if (!activityRes.rowCount || activityRes.rowCount < 1) {
            throw new Error(
                `Activity not found for courseActivityId: ${payload.courseActivityId}`,
            );
        }

        let parsed;
        try {
            parsed = JSON.parse(activity.payload || '{}');
        } catch (error) {
            throw new Error(
                `Failed to parse activity payload for courseActivityId ${payload.courseActivityId}: ${error}`,
            );
        }

        const activityName = parsed.title;
        if (!activityName) {
            throw new Error(
                `Activity title not found in payload for courseActivityId: ${payload.courseActivityId}`,
            );
        }

        const runRes = await pool.query(
            `SELECT group_id, name FROM "course-runs" WHERE id = $1`,
            [payload.runId],
        );
        const groupId = runRes.rows[0]?.group_id;
        const runName = runRes.rows[0]?.name;
        if (!groupId) {
            throw new Error(`Group not found for runId: ${payload.runId}`);
        }
        if (!runName) {
            throw new Error(`Run name not found for runId: ${payload.runId}`);
        }

        const studentsRes = await pool.query(
            `SELECT u.id, u.name FROM "group-members" gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND gm.role = 'student'`,
            [groupId],
        );

        const notificationService = new NotificationService(pool);

        const results = await Promise.allSettled(
            studentsRes.rows.map(async (student) => {
                const template = emailTemplates.deadlineSoon(
                    activityName,
                    runName,
                    payload.deadline,
                );

                try {
                    await notificationService.sendPushNotification(
                        student.id,
                        {
                            title: `Assignment "${activityName}" is due soon in "${runName}"`,
                            body: `Hi ${student.name || ''}, your assignment "${activityName}" for "${runName}" is due at ${payload.deadline}. Please make sure to submit before the deadline!`,
                            data: {
                                courseActivityId: payload.courseActivityId,
                                deadline: payload.deadline,
                            },
                        },
                    );
                } catch (pushError) {
                    console.error(
                        ` Failed to send push notification to studentId: ${student.id}`,
                        pushError,
                    );
                }

                try {
                    await notificationService.sendEmailNotification(
                        student.id,
                        template.subject,
                        template.heading,
                        template.subheading,
                        template.body,
                    );
                } catch (emailError) {
                    console.error(
                        ` Failed to send email notification to studentId: ${student.id}`,
                        emailError,
                    );
                }
            }),
        );

        const successful = results.filter(
            (r) => r.status === 'fulfilled',
        ).length;
        const failed = results.filter((r) => r.status === 'rejected').length;

        if (failed > 0) {
            const errors = results
                .filter((r) => r.status === 'rejected')
                .map((r: any) => r.reason);
            console.error('Failed notifications:', errors);
        }
    },
});

export const scheduleManagerDeadlineWarning = task({
    id: 'schedule-manager-deadline-warning',
    run: async (payload: {
        courseActivityId: number;
        runId: number;
        deadline: string;
    }) => {
        const activityRes = await pool.query(
            `SELECT a.type FROM "course-activities" ca
       JOIN activities a ON a.id = ca.activity_id
       WHERE ca.id = $1`,
            [payload.courseActivityId],
        );

        if (!activityRes.rowCount || activityRes.rowCount < 1) {
            throw new Error(
                `Activity not found for courseActivityId: ${payload.courseActivityId}`,
            );
        }

        const activityType = activityRes.rows[0].type;
        if (
            activityType !== 'quiz' &&
            activityType !== 'assignment' &&
            activityType !== 'exam'
        ) {
            console.log(
                `Skipping manager warning scheduling for activity type: ${activityType}, courseActivityId: ${payload.courseActivityId}`,
            );
            return;
        }

        const formattedDeadlineIST = convertUTCToISTString(new Date(payload.deadline));

        await sendManagerDeadlineWarning.trigger(
            {
                courseActivityId: payload.courseActivityId,
                runId: payload.runId,
                deadline: formattedDeadlineIST,
            },
            {
                delay: new Date(new Date(payload.deadline).getTime() - 30 * 60 * 1000).toISOString(),
                tags: [
                    `run_${payload.runId}`,
                    `activity_${payload.courseActivityId}`,
                    'manager_warning',
                ],
                metadata: {
                    runId: payload.runId,
                    courseActivityId: payload.courseActivityId,
                    deadline: payload.deadline,
                    type: 'manager_deadline_warning',
                    formattedDeadlineIST: formattedDeadlineIST,
                },
            },
        );
    },
});

export const sendManagerDeadlineWarning = task({
    id: 'send-manager-deadline-warning',
    run: async (payload: {
        courseActivityId: number;
        runId: number;
        deadline: string;
    }) => {
        const activityRes = await pool.query(
            `SELECT a.id as activity_id, a.type, a.payload, ca.order, c.id as course_id, c.name as course_name
       FROM "course-activities" ca
       JOIN activities a ON a.id = ca.activity_id
       JOIN courses c ON ca.course_id = c.id
       WHERE ca.id = $1`,
            [payload.courseActivityId],
        );
        const activity = activityRes.rows[0];

        if (!activityRes.rowCount || activityRes.rowCount < 1) {
            throw new Error(
                `Activity not found for courseActivityId: ${payload.courseActivityId}`,
            );
        }

        let parsed;
        try {
            parsed = JSON.parse(activity.payload || '{}');
        } catch (error) {
            throw new Error(
                `Failed to parse activity payload for courseActivityId ${payload.courseActivityId}: ${error}`,
            );
        }

        const activityName = parsed.title;
        if (!activityName) {
            throw new Error(
                `Activity title not found in payload for courseActivityId: ${payload.courseActivityId}`,
            );
        }

        const courseId = activity.course_id;

        if (!courseId) {
            throw new Error(
                `Course ID not found for courseActivityId: ${payload.courseActivityId}`,
            );
        }

        const runRes = await pool.query(
            `SELECT name FROM "course-runs" WHERE id = $1`,
            [payload.runId],
        );
        const runName = runRes.rows[0]?.name;
        if (!runName) {
            throw new Error(`Run name not found for runId: ${payload.runId}`);
        }

        const managersRes = await pool.query(
            `SELECT u.id, u.name FROM course_managers cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.course_id = $1`,
            [courseId],
        );

        if (!managersRes.rows.length) {
            console.log(`No managers found for courseId: ${courseId}`);
            return;
        }

        const notificationService = new NotificationService(pool);

        const results = await Promise.allSettled(
            managersRes.rows.map(async (manager) => {
                const template = emailTemplates.adminDeadline(
                    activityName,
                    runName,
                    payload.deadline,
                );

                try {
                    await notificationService.sendPushNotification(
                        manager.id,
                        {
                            title: `Upcoming deadline for "${activityName}" in "${runName}"`,
                            body: `Hi ${manager.name || ''}, the activity "${activityName}" in "${runName}" is due in 30 minutes (at ${payload.deadline}).`,
                            data: {
                                courseActivityId: payload.courseActivityId,
                                deadline: payload.deadline,
                            },
                        },
                    );
                } catch (pushError) {
                    console.error(
                        ` Failed to send push notification to manager: ${manager.id}`,
                        pushError,
                    );
                }

                try {
                    await notificationService.sendEmailNotification(
                        manager.id,
                        template.subject,
                        template.heading,
                        template.subheading,
                        template.body,
                    );
                } catch (emailError) {
                    console.error(
                        ` Failed to send email notification to manager: ${manager.id}`,
                        emailError,
                    );
                }
            }),
        );

        const successful = results.filter(
            (r) => r.status === 'fulfilled',
        ).length;
        const failed = results.filter((r) => r.status === 'rejected').length;

        if (failed > 0) {
            const errors = results
                .filter((r) => r.status === 'rejected')
                .map((r: any) => r.reason);
            console.error('Failed manager notifications:', errors);
        }
    },
});

export const notifyScorePublished = task({
    id: 'notify-score-published',
    run: async (payload: { courseActivityId: number; runId: number }) => {
        const { courseActivityId, runId } = payload;
        const res = await pool.query(
            `SELECT a.id as activity_id, a.type, a.payload, 
                  ca.id as course_activity_id, 
                  c.id as course_id, c.name as course_name, 
                  cr.name as run_name, cr.group_id,
                  g.name as group_name
           FROM "course-activities" ca
           JOIN activities a ON a.id = ca.activity_id
           JOIN courses c ON ca.course_id = c.id
           JOIN "course-runs" cr ON cr.id = $2
           JOIN groups g ON cr.group_id = g.id
           WHERE ca.id = $1`,
            [courseActivityId, runId],
        );
        const row = res.rows[0];

        if (!row) {
            throw new Error(
                `Activity data not found for courseActivityId: ${courseActivityId}, runId: ${runId}`,
            );
        }

        let parsed;
        try {
            parsed = JSON.parse(row.payload || '{}');
        } catch (error) {
            throw new Error(
                `Failed to parse activity payload for courseActivityId ${courseActivityId}: ${error}`,
            );
        }

        const activityName = parsed.title;
        if (!activityName) {
            throw new Error(
                `Activity title not found in payload for courseActivityId: ${courseActivityId}`,
            );
        }

        const runName = row.run_name;
        const groupId = row.group_id;

        if (!runName) {
            throw new Error(`Run name not found for runId: ${runId}`);
        }
        if (!groupId) {
            throw new Error(`Group not found for runId: ${runId}`);
        }

        const studentsRes = await pool.query(
            `SELECT u.id, u.name FROM "group-members" gm
           JOIN users u ON gm.user_id = u.id
           WHERE gm.group_id = $1 AND gm.role = 'student'`,
            [groupId],
        );

        if (!studentsRes.rows.length) {
            console.log(`No students found in group: ${groupId}`);
            return;
        }

        const notificationService = new NotificationService(pool);

        const results = await Promise.allSettled(
            studentsRes.rows.map(async (student) => {
                const template = emailTemplates.scorePublished(
                    activityName,
                    runName,
                );

                try {
                    await notificationService.sendPushNotification(
                        student.id,
                        {
                            title: `Score Published: ${activityName}`,
                            body: `Hi ${student.name || ''}, your score for "${activityName}" in "${runName}" has been published. Check your mail for more details!`,
                            data: { courseActivityId, runId },
                        },
                    );
                } catch (pushError) {
                    console.error(
                        `Failed to send push notification to student: ${student.id}`,
                        pushError,
                    );
                }

                try {
                    await notificationService.sendEmailNotification(
                        student.id,
                        template.subject,
                        template.heading,
                        template.subheading,
                        template.body,
                    );
                } catch (emailError) {
                    console.error(
                        ` Failed to send email notification to student: ${student.id}`,
                        emailError,
                    );
                }
            }),
        );

        const successful = results.filter(
            (r) => r.status === 'fulfilled',
        ).length;
        const failed = results.filter((r) => r.status === 'rejected').length;

        if (failed > 0) {
            const errors = results
                .filter((r) => r.status === 'rejected')
                .map((r: any) => r.reason);
            console.error('Failed score notifications:', errors);
        }
    },
});

export const notifyActivityPosted = task({
    id: 'notify-activity-posted',
    run: async (
        payload: { courseActivityId: number; runId: number },
        params,
    ) => {
        const { courseActivityId, runId } = payload;
        const res = await pool.query(
            `SELECT a.id as activity_id, a.type, a.payload, 
              ca.id as course_activity_id, 
              c.id as course_id, c.name as course_name, 
              cr.name as run_name, cr.group_id,
              g.name as group_name
       FROM "course-activities" ca
       JOIN activities a ON a.id = ca.activity_id
       JOIN courses c ON ca.course_id = c.id
       JOIN "course-runs" cr ON cr.id = $2
       JOIN groups g ON cr.group_id = g.id
       WHERE ca.id = $1`,
            [courseActivityId, runId],
        );
        const row = res.rows[0];

        if (!row) {
            throw new Error(
                `Activity data not found for courseActivityId: ${courseActivityId}, runId: ${runId}`,
            );
        }

        let parsed;
        try {
            parsed = JSON.parse(row.payload || '{}');
        } catch (error) {
            throw new Error(
                `Failed to parse activity payload for courseActivityId ${courseActivityId}: ${error}`,
            );
        }

        const activityName = parsed.title;
        if (!activityName) {
            throw new Error(
                `Activity title not found in payload for courseActivityId: ${courseActivityId}`,
            );
        }

        const runName = row.run_name;
        const groupId = row.group_id;

        if (!runName) {
            throw new Error(`Run name not found for runId: ${runId}`);
        }
        if (!groupId) {
            throw new Error(`Group not found for runId: ${runId}`);
        }

        const notificationService = new NotificationService(pool);
        const studentsRes = await pool.query(
            `SELECT u.id, u.name FROM "group-members" gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND gm.role = 'student'`,
            [groupId],
        );
        await Promise.allSettled(
            studentsRes.rows.map(async (student) => {
                const template = emailTemplates.activityPosted(
                    activityName,
                    runName,
                );

                try {
                    await notificationService.sendPushNotification(student.id, {
                        title: `New Activity: ${activityName}`,
                        body: `Hi ${student.name || ''}, a new activity "${activityName}" has been added to "${runName}". Check it out!`,
                        data: { courseActivityId, runId },
                    });
                } catch (pushError) {
                    console.error(
                        `Failed to send push notification to studentId: ${student.id}`,
                        pushError,
                    );
                }

                try {
                    await notificationService.sendEmailNotification(
                        student.id,
                        template.subject,
                        template.heading,
                        template.subheading,
                        template.body,
                    );
                } catch (emailError) {
                    console.error(
                        `Failed to send email notification to studentId: ${student.id}`,
                        emailError,
                    );
                }
            }),
        );
    },
});
export const notifyRedoEnabled = task({
    id: 'notify-redo-enabled',
    run: async (payload: {
        userId: string;
        courseActivityId: number;
        newDeadline: string;
        runId: number;
    }) => {
        const courseActivitiesRes = await pool.query(
            `SELECT ca.id as course_activity_id, c.id as course_id, c.name as course_name
       FROM "course-activities" ca
       JOIN courses c ON ca.course_id = c.id
       WHERE ca.id = $1`,
            [payload.courseActivityId],
        );

        if (!courseActivitiesRes.rows.length) {
            console.error(
                `No course activities found for courseActivity ID: ${payload.courseActivityId}`,
            );
            return;
        }

        const courseActivityId = courseActivitiesRes.rows[0].course_activity_id;
        const result = await pool.query(
            `SELECT a.id as activity_id, a.type, a.payload, ca.order, c.id as course_id, c.name as course_name
       FROM "course-activities" ca
       JOIN activities a ON a.id = ca.activity_id
       JOIN courses c ON ca.course_id = c.id
       WHERE ca.id = $1`,
            [courseActivityId],
        );
        const activity = result.rows[0];
        if (!activity) {
            throw new Error(
                `Activity not found for courseActivityId: ${payload.courseActivityId}`,
            );
        }

        let parsed;
        try {
            parsed = JSON.parse(activity.payload || '{}');
        } catch (error) {
            throw new Error(
                `Failed to parse activity payload for activityId ${payload.courseActivityId}: ${error}`,
            );
        }

        const activityName = parsed.title;
        if (!activityName) {
            throw new Error(
                `Activity title not found in payload for activityId: ${payload.courseActivityId}`,
            );
        }

        const courseName = activity.course_name;
        if (!courseName) {
            throw new Error(
                `Course name not found for activityId: ${payload.courseActivityId}`,
            );
        }

        const runRes = await pool.query(
            `SELECT name FROM "course-runs" WHERE id = $1`,
            [payload.runId],
        );
        const runName = runRes.rows[0]?.name;

        const userRes = await pool.query(
            `SELECT name FROM users WHERE id = $1`,
            [payload.userId],
        );
        const userName = userRes.rows[0]?.name;
        if (!userName) {
            throw new Error(`User not found for userId: ${payload.userId}`);
        }

        const notificationService = new NotificationService(pool);
        const formattedDeadlineIST = convertUTCToISTString(
            new Date(payload.newDeadline)
        );

        const courseInfo = runName ? runName : courseName;
        const template = emailTemplates.redoEnabled(
            activityName,
            formattedDeadlineIST,
            courseInfo,
        );

        try {
            await notificationService.sendPushNotification(payload.userId, {
                title: `Redo enabled for "${activityName}" in "${courseInfo}"`,
                body: `Hi ${userName}, redo for activity "${activityName}" is enabled. New deadline: ${payload.newDeadline}.`,
                data: {
                    activityId: payload.courseActivityId.toString(),
                    newDeadline: payload.newDeadline,
                },
            });
        } catch (pushError) {
            console.error(
                `Failed to send push notification to userId: ${payload.userId}`,
                pushError,
            );
        }

        try {
            await notificationService.sendEmailNotification(
                payload.userId,
                template.subject,
                template.heading,
                template.subheading,
                template.body,
            );
        } catch (emailError) {
            console.error(
                `Failed to send email notification to userId: ${payload.userId}`,
                emailError,
            );
        }
    },
});

export const notifyStudentOnAddedToGroup = task({
    id: 'notify-student-added-to-group',
    run: async (payload: { userId: string; groupId: number }) => {
        const { userId, groupId } = payload;
        const userRes = await pool.query(
            `SELECT id, name FROM users WHERE id = $1`,
            [userId],
        );
        const student = userRes.rows[0];
        if (!student) {
            throw new Error(`Student not found for userId: ${userId}`);
        }

        const groupRes = await pool.query(
            `SELECT g.id as group_id, g.name as group_name, cr.name as run_name, c.name as course_name
       FROM groups g
       LEFT JOIN "course-runs" cr ON cr.group_id = g.id
       LEFT JOIN courses c ON cr.course_id = c.id
       WHERE g.id = $1`,
            [groupId],
        );

        if (!groupRes.rows.length) {
            throw new Error(`Group not found for groupId: ${groupId}`);
        }

        const groupName = groupRes.rows[0]?.group_name;

        if (!groupName) {
            throw new Error(`Group name not found for groupId: ${groupId}`);
        }
        const notificationService = new NotificationService(pool);
        const template = emailTemplates.addedToGroup(groupName);

        try {
            await notificationService.sendPushNotification(student.id, {
                title: `You've been added to group: ${groupName}`,
                body: `Hi ${student.name || ''}, you have been added to group "${groupName}". Check your dashboard for details!`,
                data: { groupId },
            });
        } catch (pushError) {
            console.error(
                `Failed to send push notification to studentId: ${student.id}`,
                pushError,
            );
        }

        try {
            await notificationService.sendEmailNotification(
                student.id,
                template.subject,
                template.heading,
                template.subheading,
                template.body,
            );
        } catch (emailError) {
            console.error(
                `Failed to send email notification to studentId: ${student.id}`,
                emailError,
            );
        }
    },
});

export const notifyNewDocumentAdded = task({
    id: 'notify-new-document-added',
    run: async (payload: { runId: number; documentName: string }) => {
        const { runId, documentName } = payload;
        const runRes = await pool.query(
            `SELECT group_id, course_id, c.name as course_name 
       FROM "course-runs" cr
       JOIN courses c ON cr.course_id = c.id
       WHERE cr.id = $1`,
            [runId],
        );

        if (!runRes.rows.length) {
            throw new Error(`Course run not found for runId: ${runId}`);
        }

        const groupId = runRes.rows[0]?.group_id;
        const courseId = runRes.rows[0]?.course_id;
        const courseName = runRes.rows[0]?.course_name;

        if (!groupId || !courseId) {
            throw new Error(`Group or Course not found for runId: ${runId}`);
        }
        if (!courseName) {
            throw new Error(`Course name not found for runId: ${runId}`);
        }

        const studentsRes = await pool.query(
            `SELECT u.id, u.name FROM "group-members" gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND gm.role = 'student'`,
            [groupId],
        );
        const managersRes = await pool.query(
            `SELECT u.id, u.name FROM course_managers cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.course_id = $1`,
            [courseId],
        );
        if (!studentsRes.rows.length && !managersRes.rows.length) return;

        const notificationService = new NotificationService(pool);
        const template = emailTemplates.newDocument(documentName, courseName);

        await Promise.allSettled(
            studentsRes.rows.map(async (student) => {
                try {
                    await notificationService.sendPushNotification(student.id, {
                        title: `New Document Added: ${documentName}`,
                        body: `Hi ${student.name || ''}, a new document "${documentName}" has been added to your course. Check it out!`,
                        data: { documentName, runId },
                    });
                } catch (pushError) {
                    console.error(
                        `Failed to send push notification to studentId: ${student.id}`,
                        pushError,
                    );
                }

                try {
                    await notificationService.sendEmailNotification(
                        student.id,
                        template.subject,
                        template.heading,
                        template.subheading,
                        template.body,
                    );
                } catch (emailError) {
                    console.error(
                        `Failed to send email notification to studentId: ${student.id}`,
                        emailError,
                    );
                }
            }),
        );
        await Promise.allSettled(
            managersRes.rows.map(async (manager) => {
                try {
                    await notificationService.sendPushNotification(manager.id, {
                        title: `New Document Added: ${documentName}`,
                        body: `Hi ${manager.name || ''}, a new document "${documentName}" has been added to your course.`,
                        data: { documentName, runId },
                    });
                } catch (pushError) {
                    console.error(
                        `Failed to send push notification to managerId: ${manager.id}`,
                        pushError,
                    );
                }

                try {
                    await notificationService.sendEmailNotification(
                        manager.id,
                        template.subject,
                        template.heading,
                        template.subheading,
                        template.body,
                    );
                } catch (emailError) {
                    console.error(
                        `Failed to send email notification to managerId: ${manager.id}`,
                        emailError,
                    );
                }
            }),
        );
    },
});

export const scheduleNotifyMissedDeadline = task({
    id: 'schedule-notify-missed-deadline',
    run: async (payload: {
        courseActivityId: number;
        runId: number;
        deadline: string;
    }) => {
        const { courseActivityId, runId, deadline } = payload;

        const activityRes = await pool.query(
            `SELECT a.type, ca.activity_id as ca_activity_id 
       FROM "course-activities" ca
       LEFT JOIN activities a ON a.id = ca.activity_id
       WHERE ca.id = $1`,
            [courseActivityId],
        );

        console.log("<<<< Activity Query Result >>>>", {
            courseActivityId,
            rowCount: activityRes.rowCount,
            rows: activityRes.rows,
        });

        if (!activityRes.rowCount || activityRes.rowCount < 1) {
            throw new Error(
                `Course activity not found for courseActivityId: ${courseActivityId}`,
            );
        }

        const row = activityRes.rows[0];

        if (!row.type) {
            throw new Error(
                `Activity not found - course_activity ${courseActivityId} references activity_id ${row.ca_activity_id} which doesn't exist in activities table`,
            );
        }

        const activityType = row.type;
        if (
            activityType !== 'quiz' &&
            activityType !== 'assignment' &&
            activityType !== 'exam'
        ) {
            console.log(
                `Skipping missed deadline scheduling for activity type: ${activityType}, courseActivityId: ${courseActivityId}`,
            );
            return;
        }

        const formattedDeadlineIST = convertUTCToISTString(new Date(deadline));

        await notifyMissedDeadline.trigger(
            { courseActivityId, runId, deadline: formattedDeadlineIST },
            {
                delay: deadline,
                tags: [
                    `run_${runId}`,
                    `activity_${courseActivityId}`,
                    'missed_deadline',
                ],
                metadata: {
                    runId,
                    courseActivityId,
                    deadline,
                    type: 'missed_deadline_notification',
                    formattedDeadlineIST: formattedDeadlineIST,
                },
            },
        );
    },
});

export const notifyMissedDeadline = task({
    id: 'notify-missed-deadline',
    run: async (payload: {
        courseActivityId: number;
        runId: number;
        deadline: string;
    }) => {
        const { courseActivityId, runId, deadline } = payload;
        const res = await pool.query(
            `SELECT a.id as activity_id, a.type, a.payload, 
              ca.id as course_activity_id, 
              c.id as course_id, c.name as course_name, 
              cr.name as run_name, cr.group_id,
              g.name as group_name
       FROM "course-activities" ca
       JOIN activities a ON a.id = ca.activity_id
       JOIN courses c ON ca.course_id = c.id
       JOIN "course-runs" cr ON cr.id = $2
       JOIN groups g ON cr.group_id = g.id
       WHERE ca.id = $1`,
            [courseActivityId, runId],
        );
        const row = res.rows[0];
        if (!row) {
            throw new Error(
                `Activity data not found for courseActivityId: ${courseActivityId}, runId: ${runId}`,
            );
        }

        let parsed;
        try {
            parsed = JSON.parse(row.payload || '{}');
        } catch (error) {
            throw new Error(
                `Failed to parse activity payload for courseActivityId ${courseActivityId}: ${error}`,
            );
        }

        const activityName = parsed.title;
        if (!activityName) {
            throw new Error(
                `Activity title not found in payload for courseActivityId: ${courseActivityId}`,
            );
        }

        const runName = row.run_name;
        const groupId = row.group_id;
        const activityId = row.activity_id;

        if (!runName) {
            throw new Error(`Run name not found for runId: ${runId}`);
        }
        if (!groupId) {
            throw new Error(`Group not found for runId: ${runId}`);
        }

        const studentsRes = await pool.query(
            `SELECT u.id, u.name FROM "group-members" gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND gm.role = 'student'`,
            [groupId],
        );
        if (!studentsRes.rows.length) return;

        const activityType = row?.type;
        let submittedIds: string[] = [];

        if (activityType === 'assignment') {
            const submissions = await pool.query(
                `SELECT DISTINCT user_id FROM assignment_submissions 
         WHERE activity_id = $1 AND course_run_id = $2`,
                [activityId, runId],
            );
            submittedIds = submissions.rows.map((r) => r.user_id);
        } else if (activityType === 'quiz') {
            const attempts = await pool.query(
                `SELECT DISTINCT user_id FROM "quiz-attempts" 
         WHERE activity_id = $1 AND course_run_id = $2`,
                [activityId, runId],
            );
            submittedIds = attempts.rows.map((r) => r.user_id);
        } else if (activityType === 'exam') {
            const examSubmissions = await pool.query(
                `SELECT DISTINCT user_id FROM exam_submissions 
         WHERE activity_id = $1 AND course_run_id = $2 AND submitted_at IS NOT NULL`,
                [activityId, runId],
            );
            submittedIds = examSubmissions.rows.map((r) => r.user_id);
        }

        const studentsToNotify = studentsRes.rows.filter(
            (s) => !submittedIds.includes(s.id),
        );
        if (!studentsToNotify.length) {
            console.log('No students to notify - all have submitted');
            return;
        }

        const notificationService = new NotificationService(pool);
        const template = emailTemplates.missedDeadline(activityName, runName);

        const results = await Promise.allSettled(
            studentsToNotify.map(async (student) => {
                try {
                    await notificationService.sendPushNotification(
                        student.id,
                        {
                            title: `Missed Deadline: ${activityName}`,
                            body: `Hi ${student.name || ''}, you missed the deadline for \"${activityName}\" in \"${runName}\". Please check with your facilitator for next steps.`,
                            data: { courseActivityId, runId, deadline },
                        },
                    );
                } catch (pushError) {
                    console.error(
                        ` Failed to send push notification to studentId: ${student.id}`,
                        pushError,
                    );
                }

                try {
                    await notificationService.sendEmailNotification(
                        student.id,
                        template.subject,
                        template.heading,
                        template.subheading,
                        template.body,
                    );
                } catch (emailError) {
                    console.error(
                        ` Failed to send email notification to studentId: ${student.id}`,
                        emailError,
                    );
                }
            }),
        );

        const successful = results.filter(
            (r) => r.status === 'fulfilled',
        ).length;
        const failed = results.filter((r) => r.status === 'rejected').length;

        if (failed > 0) {
            const errors = results
                .filter((r) => r.status === 'rejected')
                .map((r: any) => r.reason);
            console.error('Failed notifications:', errors);
        }
    },
});

export const notifyFacilitatorPostDeadlineSummary = task({
    id: 'notify-facilitator-post-deadline-summary',
    run: async (payload: {
        courseActivityId: number;
        runId: number;
        deadline: string;
    }) => {
        const { courseActivityId, runId, deadline } = payload;

        const res = await pool.query(
            `SELECT a.id as activity_id, a.type, a.payload,
                            ca.id as course_activity_id,
                            c.id as course_id, c.name as course_name,
                            cr.name as run_name, cr.group_id,
                            g.name as group_name
       FROM "course-activities" ca
       JOIN activities a ON a.id = ca.activity_id
       JOIN courses c ON ca.course_id = c.id
       JOIN "course-runs" cr ON cr.id = $2
       JOIN groups g ON cr.group_id = g.id
       WHERE ca.id = $1`,
            [courseActivityId, runId],
        );
        const row = res.rows[0];
        if (!row) {
            throw new Error(
                `Activity data not found for courseActivityId: ${courseActivityId}, runId: ${runId} `,
            );
        }

        let parsed;
        try {
            parsed = JSON.parse(row.payload || '{}');
        } catch (error) {
            throw new Error(
                `Failed to parse activity payload for courseActivityId ${courseActivityId}: ${error} `,
            );
        }

        const activityName = parsed.title;
        if (!activityName) {
            throw new Error(
                `Activity title not found in payload for courseActivityId: ${courseActivityId} `,
            );
        }

        const runName = row.run_name;
        const groupId = row.group_id;
        const activityId = row.activity_id;
        const courseId = row.course_id;

        if (!runName) {
            throw new Error(`Run name not found for runId: ${runId} `);
        }
        if (!groupId || !courseId) {
            throw new Error(
                `Group or Course not found for courseActivityId: ${courseActivityId}, runId: ${runId} `,
            );
        }

        const studentsRes = await pool.query(
            `SELECT u.id FROM "group-members" gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND gm.role = 'student'`,
            [groupId],
        );
        if (!studentsRes.rows.length) return;

        const studentIds = studentsRes.rows.map((s) => s.id);
        const activityType = row?.type;
        let submittedIds: string[] = [];

        if (activityType === 'assignment') {
            const submissions = await pool.query(
                `SELECT DISTINCT user_id FROM assignment_submissions 
         WHERE activity_id = $1 AND course_run_id = $2`,
                [activityId, runId],
            );
            submittedIds = submissions.rows.map((r) => r.user_id);
        } else if (activityType === 'quiz') {
            const attempts = await pool.query(
                `SELECT DISTINCT user_id FROM "quiz-attempts" 
         WHERE activity_id = $1 AND course_run_id = $2`,
                [activityId, runId],
            );
            submittedIds = attempts.rows.map((r) => r.user_id);
        } else if (activityType === 'exam') {
            const examSubmissions = await pool.query(
                `SELECT DISTINCT user_id FROM exam_submissions 
         WHERE activity_id = $1 AND course_run_id = $2 AND submitted_at IS NOT NULL`,
                [activityId, runId],
            );
            submittedIds = examSubmissions.rows.map((r) => r.user_id);
        }

        const submitted = studentIds.filter((id) =>
            submittedIds.includes(id),
        ).length;
        const notSubmitted = studentIds.length - submitted;

        const facilitatorsRes = await pool.query(
            `SELECT u.id, u.name FROM course_managers cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.course_id = $1`,
            [courseId],
        );
        if (!facilitatorsRes.rows.length) return;

        const notificationService = new NotificationService(pool);
        const template = emailTemplates.facilitatorSummary(
            activityName,
            runName,
            submitted,
            notSubmitted,
        );

        await Promise.allSettled(
            facilitatorsRes.rows.map(async (facilitator) => {
                try {
                    await notificationService.sendPushNotification(facilitator.id, {
                        title: `Graded activity deadline passed: ${activityName} `,
                        body: `Activity "${activityName}" in "${runName}" deadline passed.Submitted: ${submitted}, Not submitted: ${notSubmitted} `,
                        data: { courseActivityId, submitted, notSubmitted },
                    });
                } catch (pushError) {
                    console.error(
                        `Failed to send push notification to facilitatorId: ${facilitator.id}`,
                        pushError,
                    );
                }

                try {
                    await notificationService.sendEmailNotification(
                        facilitator.id,
                        template.subject,
                        template.heading,
                        template.subheading,
                        template.body,
                    );
                } catch (emailError) {
                    console.error(
                        `Failed to send email notification to facilitatorId: ${facilitator.id}`,
                        emailError,
                    );
                }
            }),
        );
    },
});

export const scheduleNotifyFacilitatorPostDeadlineSummary = task({
    id: 'schedule-notify-facilitator-post-deadline-summary',
    run: async (payload: {
        courseActivityId: number;
        runId: number;
        deadline: string;
    }) => {
        const { courseActivityId, runId, deadline } = payload;
        console.log("payload", {
            courseActivityId,
            runId,
            deadline
        })

        const activityRes = await pool.query(
            `SELECT a.type, ca.activity_id as ca_activity_id 
       FROM "course-activities" ca
       LEFT JOIN activities a ON a.id = ca.activity_id
       WHERE ca.id = $1`,
            [courseActivityId],
        );

        if (!activityRes.rowCount || activityRes.rowCount < 1) {
            throw new Error(
                `Course activity not found for courseActivityId: ${courseActivityId} `,
            );
        }

        const row = activityRes.rows[0];

        if (!row.type) {
            throw new Error(
                `Activity not found - course_activity ${courseActivityId} references activity_id ${row.ca_activity_id} which doesn't exist in activities table`,
            );
        }

        const activityType = row.type;
        if (
            activityType !== 'quiz' &&
            activityType !== 'assignment' &&
            activityType !== 'exam'
        ) {
            console.log(
                `Skipping facilitator summary scheduling for activity type: ${activityType}, courseActivityId: ${courseActivityId}`,
            );
            return;
        }

        const formattedDeadlineIST = convertUTCToISTString(new Date(deadline));

        await notifyFacilitatorPostDeadlineSummary.trigger(
            { courseActivityId, runId, deadline: formattedDeadlineIST },
            {
                delay: deadline,
                tags: [
                    `run_${runId}`,
                    `activity_${courseActivityId}`,
                    'facilitator_summary',
                ],
                metadata: {
                    runId,
                    courseActivityId,
                    deadline,
                    activityType,
                    formattedDeadlineIST: formattedDeadlineIST,
                    type: 'facilitator_post_deadline_summary',
                },
            },
        );
    },
});

export const notifyFacilitatorEndOfCourseRunFinalize = task({
    id: 'notify-facilitator-end-of-course-run-finalize',
    run: async (payload: { courseRunId: number }) => {
        const { courseRunId } = payload;
        const res = await pool.query(
            `SELECT cr.name as run_name, cr.end_date, c.id as course_id, c.name as course_name, g.name as group_name
       FROM "course-runs" cr
       JOIN courses c ON cr.course_id = c.id
       JOIN groups g ON cr.group_id = g.id
       WHERE cr.id = $1`,
            [courseRunId],
        );
        const row = res.rows[0];
        if (!row) {
            throw new Error(
                `Course run not found for courseRunId: ${courseRunId}`,
            );
        }

        const runName = row.run_name;
        const courseName = row.course_name;
        const groupName = row.group_name;
        const courseId = row.course_id;

        if (!runName || !courseName) {
            throw new Error(
                `Course run or course name not found for courseRunId: ${courseRunId}`,
            );
        }
        if (!courseId) {
            throw new Error(
                `Course ID not found for courseRunId: ${courseRunId}`,
            );
        }

        const endDate = row.end_date
            ? new Date(row.end_date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            })
            : '';

        const facilitatorsRes = await pool.query(
            `SELECT u.id, u.name FROM course_managers cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.course_id = $1`,
            [courseId],
        );
        if (!facilitatorsRes.rows.length) return;
        const notificationService = new NotificationService(pool);
        const template = emailTemplates.courseRunFinalize(
            courseName,
            runName,
            endDate,
        );

        await Promise.allSettled(
            facilitatorsRes.rows.map(async (facilitator) => {
                try {
                    await notificationService.sendPushNotification(facilitator.id, {
                        title: `Course run finalized: ${runName}`,
                        body: `The course run "${runName}" for course "${courseName}" has been finalized. Please check the dashboard for details.`,
                        data: { courseRunId },
                    });
                } catch (pushError) {
                    console.error(
                        `Failed to send push notification to facilitatorId: ${facilitator.id}`,
                        pushError,
                    );
                }

                try {
                    await notificationService.sendEmailNotification(
                        facilitator.id,
                        template.subject,
                        template.heading,
                        template.subheading,
                        template.body,
                    );
                } catch (emailError) {
                    console.error(
                        `Failed to send email notification to facilitatorId: ${facilitator.id}`,
                        emailError,
                    );
                }
            }),
        );
    },
});

export const scheduleNotifyFacilitatorEndOfCourseRunFinalize = task({
    id: 'schedule-notify-facilitator-end-of-course-run-finalize',
    run: async (payload: { courseRunId: number }) => {
        const { courseRunId } = payload;
        const runRes = await pool.query(
            `SELECT end_date FROM "course-runs" WHERE id = $1`,
            [courseRunId],
        );

        if (!runRes.rows.length) {
            throw new Error(
                `Course run not found for courseRunId: ${courseRunId}`,
            );
        }

        const endDate = runRes.rows[0]?.end_date;
        if (!endDate) {
            throw new Error(
                `End date not found for courseRunId: ${courseRunId}`,
            );
        }

        await notifyFacilitatorEndOfCourseRunFinalize.trigger(
            { courseRunId },
            {
                delay: new Date(endDate).toISOString(),
                tags: [`run_${courseRunId}`],
                metadata: { courseRunId, endDate },
            },
        );
    },
});
