import mockData from './mock-data.json';

/**
 * Mock data utilities for notification tests
 * All operations work on in-memory mock data, no database required
 */

export interface TestContext {
  mockData: typeof mockData;
  notificationsSent: Map<string, any[]>;
  emailsSent: Map<string, any[]>;
}

/**
 * Mock Query Engine - Simulates database queries on mock JSON data
 */
export class MockQueryEngine {
  private data: typeof mockData;

  constructor() {
    this.data = JSON.parse(JSON.stringify(mockData)); // Deep clone
  }

  /**
   * Simulate SQL query on mock data
   */
  async query(sql: string, params: any[] = []): Promise<{ rows: any[] }> {
    // Parse simple queries and return mock data
    const sqlLower = sql.toLowerCase().trim();

    // Debug logging
    const isDebug = process.env.DEBUG_QUERIES === 'true';
    if (isDebug) {
      console.log('\n🔍 Query:', sql.substring(0, 100) + '...');
      console.log('📊 Params:', params);
    }

    // IMPORTANT: Check complex patterns FIRST before simple patterns!
    // Get activity with run info (complex join - must be checked before simple activity lookup)
    if (sqlLower.includes('join "course-runs" cr on cr.id') && sqlLower.includes('join groups g')) {
      const courseActivityId = params[0];
      const runId = params[1];
      
      if (isDebug) {
        console.log('🔍 Complex join query detected - courseActivityId:', courseActivityId, 'runId:', runId);
      }
      
      const courseActivity = this.data.course_activities.find((ca: any) => ca.id === courseActivityId);
      if (!courseActivity) {
        if (isDebug) console.warn(`⚠️  CourseActivity ${courseActivityId} not found`);
        return { rows: [] };
      }

      const activity = this.data.activities.find((a: any) => a.id === courseActivity.activity_id);
      const course = this.data.courses.find((c: any) => c.id === courseActivity.course_id);
      const run = this.data.course_runs.find((r: any) => r.id === runId);
      
      if (!activity || !course || !run) {
        if (isDebug) console.warn(`⚠️  Missing data - activity: ${!!activity}, course: ${!!course}, run: ${!!run}`);
        return { rows: [] };
      }

      const group = this.data.groups.find((g: any) => g.id === run.group_id);

      const result = {
        rows: [{
          activity_id: activity.id,
          type: activity.type,
          payload: activity.payload,
          course_activity_id: courseActivity.id,
          course_id: course.id,
          course_name: course.name,
          run_name: run.name,
          group_id: run.group_id,
          group_name: group?.name
        }]
      };

      if (isDebug) {
        console.log('✅ Found activity with run info - group_id:', result.rows[0].group_id);
      }

      return result;
    }

    // Activity lookup (simple - must come AFTER complex join check)
    if (sqlLower.includes('from activities a') && sqlLower.includes('join "course-activities" ca') && sqlLower.includes('where ca.id')) {
      const courseActivityId = params[0];
      const courseActivity = this.data.course_activities.find((ca: any) => ca.id === courseActivityId);
      if (!courseActivity) {
        if (isDebug) console.log('❌ CourseActivity not found:', courseActivityId);
        return { rows: [] };
      }

      const activity = this.data.activities.find((a: any) => a.id === courseActivity.activity_id);
      if (!activity) return { rows: [] };

      const course = this.data.courses.find((c: any) => c.id === courseActivity.course_id);
      if (!course) return { rows: [] };

      return {
        rows: [{
          activity_id: activity.id,
          type: activity.type,
          payload: activity.payload,
          order: courseActivity.order,
          course_id: course.id,
          course_name: course.name
        }]
      };
    }

    // Get group_id from course run
    if (sqlLower.includes('from "course-runs"') && sqlLower.includes('where id')) {
      const runId = params[0];
      const run = this.data.course_runs.find((r: any) => r.id === runId);
      return run ? { rows: [{ group_id: run.group_id, name: run.name, course_id: run.course_id }] } : { rows: [] };
    }

    // Get students in group
    if (sqlLower.includes('from "group-members" gm') && sqlLower.includes("gm.role = 'student'")) {
      const groupId = params[0];
      const members = this.data.group_members.filter((gm: any) => gm.group_id === groupId && gm.role === 'student');
      const students = members.map((m: any) => {
        const user = this.data.users.find((u: any) => u.id === m.user_id);
        return user ? { id: user.id, name: user.name } : null;
      }).filter(Boolean);
      return { rows: students };
    }

    // Get course managers
    if (sqlLower.includes('from course_managers cm') && sqlLower.includes('where cm.course_id')) {
      const courseId = params[0];
      const managers = this.data.course_managers.filter((cm: any) => cm.course_id === courseId);
      const managerUsers = managers.map((m: any) => {
        const user = this.data.users.find((u: any) => u.id === m.user_id);
        return user ? { id: user.id, name: user.name } : null;
      }).filter(Boolean);
      return { rows: managerUsers };
    }

    // Get course activity by activity_id
    if (sqlLower.includes('from "course-activities" ca') && sqlLower.includes('where ca.activity_id')) {
      const activityId = params[0];
      const courseActivities = this.data.course_activities.filter((ca: any) => ca.activity_id === activityId);
      const results = courseActivities.map((ca: any) => {
        const course = this.data.courses.find((c: any) => c.id === ca.course_id);
        return {
          course_activity_id: ca.id,
          course_id: course?.id,
          course_name: course?.name
        };
      });
      return { rows: results };
    }

    // Get user info
    if (sqlLower.includes('from users') && sqlLower.includes('where id')) {
      const userId = params[0];
      const user = this.data.users.find((u: any) => u.id === userId);
      return user ? { rows: [{ id: user.id, name: user.name }] } : { rows: [] };
    }

    // Get group info
    if (sqlLower.includes('from groups g') && sqlLower.includes('where g.id')) {
      const groupId = params[0];
      const group = this.data.groups.find((g: any) => g.id === groupId);
      if (!group) return { rows: [] };

      const run = this.data.course_runs.find((r: any) => r.group_id === groupId);
      const course = run ? this.data.courses.find((c: any) => c.id === run.course_id) : null;

      return {
        rows: [{
          group_id: group.id,
          group_name: group.name,
          run_name: run?.name,
          course_name: course?.name
        }]
      };
    }

    // Get run info with course
    if (sqlLower.includes('from "course-runs" cr') && sqlLower.includes('join courses c')) {
      const runId = params[0];
      const run = this.data.course_runs.find((r: any) => r.id === runId);
      if (!run) return { rows: [] };

      const course = this.data.courses.find((c: any) => c.id === run.course_id);

      return {
        rows: [{
          group_id: run.group_id,
          course_id: run.course_id,
          course_name: course?.name
        }]
      };
    }

    // Get assignment submissions
    if (sqlLower.includes('from assignment_submissions') && sqlLower.includes('where activity_id')) {
      const activityId = params[0];
      const runId = params[1];
      const submissions = this.data.assignment_submissions.filter(
        (s: any) => s.activity_id === activityId && s.course_run_id === runId
      );
      return { rows: submissions.map((s: any) => ({ user_id: s.user_id })) };
    }

    // Get quiz attempts
    if (sqlLower.includes('from "quiz-attempts"') && sqlLower.includes('where activity_id')) {
      const activityId = params[0];
      const runId = params[1];
      const attempts = this.data.quiz_attempts.filter(
        (a: any) => a.activity_id === activityId && a.course_run_id === runId && a.completed_at
      );
      return { rows: attempts.map((a: any) => ({ user_id: a.user_id })) };
    }

    // Get exam submissions
    if (sqlLower.includes('from exam_submissions') && sqlLower.includes('where activity_id')) {
      const activityId = params[0];
      const runId = params[1];
      const exams = this.data.exam_submissions.filter(
        (e: any) => e.activity_id === activityId && e.course_run_id === runId && e.submitted_at
      );
      return { rows: exams.map((e: any) => ({ user_id: e.user_id })) };
    }

    console.warn('Unhandled query:', sql);
    if (isDebug) {
      console.log('❌ No pattern matched for this query');
      console.log('SQL (first 200 chars):', sql.substring(0, 200));
    }
    return { rows: [] };
  }
}

/**
 * Setup test context - no database needed
 */
export async function setupTestDatabase(): Promise<MockQueryEngine> {
  console.log('✓ Mock data loaded');
  return new MockQueryEngine();
}

/**
 * Clean up test context - no-op for mock data
 */
export async function cleanupTestDatabase(): Promise<void> {
  console.log('✓ Test cleanup complete');
}

/**
 * Mock notification service to track notifications
 */
export class MockNotificationService {
  public pushNotifications: Map<string, any[]> = new Map();
  public emailNotifications: Map<string, any[]> = new Map();

  async sendPushNotification(userId: string, notification: any): Promise<void> {
    if (!this.pushNotifications.has(userId)) {
      this.pushNotifications.set(userId, []);
    }
    this.pushNotifications.get(userId)!.push(notification);
  }

  async sendEmailNotification(
    userId: string,
    subject: string,
    heading: string,
    subheading: string,
    body: string
  ): Promise<void> {
    if (!this.emailNotifications.has(userId)) {
      this.emailNotifications.set(userId, []);
    }
    this.emailNotifications.get(userId)!.push({
      subject,
      heading,
      subheading,
      body,
    });
  }

  reset(): void {
    this.pushNotifications.clear();
    this.emailNotifications.clear();
  }

  getPushNotificationsFor(userId: string): any[] {
    return this.pushNotifications.get(userId) || [];
  }

  getEmailNotificationsFor(userId: string): any[] {
    return this.emailNotifications.get(userId) || [];
  }

  getAllPushNotificationRecipients(): string[] {
    return Array.from(this.pushNotifications.keys());
  }

  getAllEmailNotificationRecipients(): string[] {
    return Array.from(this.emailNotifications.keys());
  }
}

/**
 * Test assertion helpers
 */
export class TestAssertions {
  constructor(private mockService: MockNotificationService) {}

  assertRecipientsMatch(
    expected: string[],
    notExpected: string[],
    type: 'push' | 'email' = 'push'
  ): { passed: boolean; message: string; details: any } {
    const actualRecipients =
      type === 'push'
        ? this.mockService.getAllPushNotificationRecipients()
        : this.mockService.getAllEmailNotificationRecipients();

    const missingRecipients = expected.filter(
      (userId) => !actualRecipients.includes(userId)
    );
    const unexpectedRecipients = notExpected.filter((userId) =>
      actualRecipients.includes(userId)
    );

    const passed =
      missingRecipients.length === 0 && unexpectedRecipients.length === 0;

    let message = '';
    if (passed) {
      message = `✓ All expected recipients received ${type} notifications`;
    } else {
      message = `✗ ${type.toUpperCase()} notification recipients mismatch`;
    }

    return {
      passed,
      message,
      details: {
        expected,
        notExpected,
        actual: actualRecipients,
        missing: missingRecipients,
        unexpected: unexpectedRecipients,
      },
    };
  }

  assertNotificationCount(
    userId: string,
    expectedCount: number,
    type: 'push' | 'email' = 'push'
  ): { passed: boolean; message: string; details: any } {
    const notifications =
      type === 'push'
        ? this.mockService.getPushNotificationsFor(userId)
        : this.mockService.getEmailNotificationsFor(userId);

    const actualCount = notifications.length;
    const passed = actualCount === expectedCount;

    return {
      passed,
      message: passed
        ? `✓ User ${userId} received ${expectedCount} ${type} notification(s)`
        : `✗ User ${userId} expected ${expectedCount} ${type} notification(s) but received ${actualCount}`,
      details: {
        userId,
        expectedCount,
        actualCount,
        notifications,
      },
    };
  }

  assertNotificationContent(
    userId: string,
    expectedKeywords: string[],
    type: 'push' | 'email' = 'push'
  ): { passed: boolean; message: string; details: any } {
    const notifications =
      type === 'push'
        ? this.mockService.getPushNotificationsFor(userId)
        : this.mockService.getEmailNotificationsFor(userId);

    if (notifications.length === 0) {
      return {
        passed: false,
        message: `✗ No ${type} notifications found for user ${userId}`,
        details: { userId, expectedKeywords, notifications: [] },
      };
    }

    const notificationText =
      type === 'push'
        ? JSON.stringify(notifications[0])
        : JSON.stringify(notifications[0]);

    const missingKeywords = expectedKeywords.filter(
      (keyword) => !notificationText.toLowerCase().includes(keyword.toLowerCase())
    );

    const passed = missingKeywords.length === 0;

    return {
      passed,
      message: passed
        ? `✓ ${type.toUpperCase()} notification contains all expected keywords`
        : `✗ ${type.toUpperCase()} notification missing keywords: ${missingKeywords.join(', ')}`,
      details: {
        userId,
        expectedKeywords,
        missingKeywords,
        notification: notifications[0],
      },
    };
  }
}

/**
 * Test result reporter
 */
export class TestReporter {
  private results: Array<{
    testName: string;
    scenario: string;
    passed: boolean;
    message: string;
    details?: any;
    timestamp: Date;
  }> = [];

  addResult(
    testName: string,
    scenario: string,
    result: { passed: boolean; message: string; details?: any }
  ): void {
    this.results.push({
      testName,
      scenario,
      passed: result.passed,
      message: result.message,
      details: result.details,
      timestamp: new Date(),
    });
  }

  printSummary(): void {
    console.log('\n' + '='.repeat(80));
    console.log('TEST SUMMARY');
    console.log('='.repeat(80));

    const totalTests = this.results.length;
    const passedTests = this.results.filter((r) => r.passed).length;
    const failedTests = totalTests - passedTests;

    console.log(`\nTotal Tests: ${totalTests}`);
    console.log(`Passed: ${passedTests} ✓`);
    console.log(`Failed: ${failedTests} ✗`);
    console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(2)}%\n`);

    // Group by test name
    const byTest = new Map<string, typeof this.results>();
    for (const result of this.results) {
      if (!byTest.has(result.testName)) {
        byTest.set(result.testName, []);
      }
      byTest.get(result.testName)!.push(result);
    }

    for (const [testName, testResults] of byTest) {
      const testPassed = testResults.every((r) => r.passed);
      const icon = testPassed ? '✓' : '✗';
      console.log(`\n${icon} ${testName}`);
      console.log('-'.repeat(80));

      for (const result of testResults) {
        const resultIcon = result.passed ? '  ✓' : '  ✗';
        console.log(`${resultIcon} ${result.scenario}: ${result.message}`);

        if (!result.passed && result.details) {
          console.log('    Details:', JSON.stringify(result.details, null, 2));
        }
      }
    }

    console.log('\n' + '='.repeat(80) + '\n');
  }

  getResults() {
    return this.results;
  }

  hasFailures(): boolean {
    return this.results.some((r) => !r.passed);
  }
}
