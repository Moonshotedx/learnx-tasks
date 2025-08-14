import { task } from '@trigger.dev/sdk/v3';
import { NotificationService } from '../lib/notify-service';
import pool from '../lib/db';

export const scheduleStudentDeadlineNotification = task({
  id: 'schedule-student-deadline-notification',
  run: async (payload: { courseActivityId: number; runId: number; deadline: string }) => {
    const activityRes = await pool.query(
      `SELECT a.type FROM activities a
       JOIN "course-activities" ca ON ca.activity_id = a.id
       WHERE ca.id = $1`, [payload.courseActivityId]
    );
    const activityType = activityRes.rows[0]?.type;
    if (activityType !== 'quiz' && activityType !== 'assignment') return;

    await sendStudentDeadlineNotification.trigger(
      { courseActivityId: payload.courseActivityId, runId: payload.runId, deadline: payload.deadline },
      {
        delay: new Date(new Date(payload.deadline).getTime() - 2 * 60 * 60 * 1000).toISOString(),
        tags: [`run_${payload.runId}`, `activity_${payload.courseActivityId}`],
        metadata: { runId: payload.runId, courseActivityId: payload.courseActivityId }
      }
    );
  }
});

export const sendStudentDeadlineNotification = task({
  id: 'send-student-deadline-notification',
  run: async (payload: { courseActivityId: number; runId: number; deadline: string }) => {
    const activityRes = await pool.query(
      `SELECT a.type, a.payload, ca.order, c.name as course_name
       FROM activities a
       JOIN "course-activities" ca ON ca.activity_id = a.id
       JOIN courses c ON ca.course_id = c.id
       WHERE ca.id = $1`, [payload.courseActivityId]
    );
    const activity = activityRes.rows[0];
    let activityName = activity?.type;
    try {
      const parsed = JSON.parse(activity?.payload || '{}');
      if (parsed.name) activityName = parsed.name;
    } catch {}
    const courseName = activity?.course_name || 'your course';
    const studentsRes = await pool.query(
      `SELECT u.id, u.name FROM "group-members" gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1`, [payload.runId]
    );
const notificationService = new NotificationService(pool);

    await Promise.allSettled(studentsRes.rows.map(async (student) => {
      await notificationService.sendPushNotification(student.id, {
        title: `Assignment "${activityName}" is due soon in "${courseName}"`,
        body: `Hi ${student.name || ''}, your assignment "${activityName}" for "${courseName}" is due at ${payload.deadline}. Please make sure to submit before the deadline!`,
        data: { courseActivityId: payload.courseActivityId, deadline: payload.deadline }
      });
      await notificationService.sendEmailNotification(student.id, `Assignment "${activityName}" is due soon in "${courseName}"`, `Hi ${student.name || ''}, your assignment "${activityName}" for "${courseName}" is due at ${payload.deadline}. Please make sure to submit before the deadline!`);
    }));
  }
});

export const scheduleManagerDeadlineWarning = task({
  id: 'schedule-manager-deadline-warning',
  run: async (payload: { courseActivityId: number; runId: number; deadline: string }) => {
    const activityRes = await pool.query(
      `SELECT a.type FROM activities a
       JOIN "course-activities" ca ON ca.activity_id = a.id
       WHERE ca.id = $1`, [payload.courseActivityId]
    );
    const activityType = activityRes.rows[0]?.type;
    if (activityType !== 'quiz' && activityType !== 'assignment') return;

    await sendManagerDeadlineWarning.trigger(
      { courseActivityId: payload.courseActivityId, runId: payload.runId, deadline: payload.deadline },
      {
        delay: new Date(new Date(payload.deadline).getTime() - 30 * 60 * 1000).toISOString(),
        tags: [`run_${payload.runId}`, `activity_${payload.courseActivityId}`],
        metadata: { runId: payload.runId, courseActivityId: payload.courseActivityId }
      }
    );
  }
});

export const sendManagerDeadlineWarning = task({
  id: 'send-manager-deadline-warning',
  run: async (payload: { courseActivityId: number; runId: number; deadline: string }) => {
    const activityRes = await pool.query(
      `SELECT a.type, a.payload, ca.order, c.name as course_name
       FROM activities a
       JOIN "course-activities" ca ON ca.activity_id = a.id
       JOIN courses c ON ca.course_id = c.id
       WHERE ca.id = $1`, [payload.courseActivityId]
    );
    const activity = activityRes.rows[0];
    let activityName = activity?.type;
    try {
      const parsed = JSON.parse(activity?.payload || '{}');
      if (parsed.name) activityName = parsed.name;
    } catch {}
    const courseName = activity?.course_name || 'the course';
    const runRes = await pool.query(
      `SELECT course_id FROM "course-runs" WHERE id = $1`, [payload.runId]
    );
    const courseId = runRes.rows[0]?.course_id;
    if (!courseId) return;
    const managersRes = await pool.query(
      `SELECT u.id, u.name FROM course_managers cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.course_id = $1`, [courseId]
    );
    const notificationService = new NotificationService(pool);

    await Promise.allSettled(managersRes.rows.map(async (manager) => {
      await notificationService.sendPushNotification(manager.id, {
        title: `Upcoming deadline for "${activityName}" in "${courseName}"`,
        body: `Hi ${manager.name || ''}, the activity "${activityName}" in "${courseName}" is due in 30 minutes (at ${payload.deadline}).`,
        data: { courseActivityId: payload.courseActivityId, deadline: payload.deadline }
      });
      await notificationService.sendEmailNotification(manager.id, `Upcoming deadline for "${activityName}" in "${courseName}"`, `Hi ${manager.name || ''}, the activity "${activityName}" in "${courseName}" is due in 30 minutes (at ${payload.deadline}).`);
    }));
  }
});

export const notifyScorePublished = task({
    id: 'notify-score-published',
    run: async (payload: { courseActivityId: string; runId: string }) => {
        const { courseActivityId, runId } = payload;
        const res = await pool.query(
          `SELECT a.type, a.payload, ca.id as course_activity_id, c.name as course_name, cr.name as run_name, g.name as group_name
           FROM activities a
           JOIN "course-activities" ca ON ca.activity_id = a.id
           JOIN courses c ON ca.course_id = c.id
           JOIN "course-runs" cr ON cr.id = $2
           JOIN groups g ON cr.group_id = g.id
           WHERE ca.id = $1`, [courseActivityId, runId]
        );
        const row = res.rows[0];
        let activityName = row?.type || 'Activity';
        try {
          const parsed = JSON.parse(row?.payload || '{}');
          if (parsed.name) activityName = parsed.name;
        } catch {}
        const courseName = row?.course_name ;
        const runName = row?.run_name ;
        const groupName = row?.group_name ;

        const studentsRes = await pool.query(
          `SELECT u.id, u.name FROM "group-members" gm
           JOIN users u ON gm.user_id = u.id
           WHERE gm.group_id = (SELECT group_id FROM "course-runs" WHERE id = $1) AND gm.role = 'student'`, [runId]
        );
        const notificationService = new NotificationService(pool);
        await Promise.allSettled(studentsRes.rows.map(async (student) => {
          await notificationService.sendPushNotification(student.id, {
            title: `Score Published: ${activityName}`,
            body: `Hi ${student.name || ''}, your score for "${activityName}" in "${courseName}" has been published. Check your mail for more details!`,
            data: { courseActivityId, runId }
          });
          await notificationService.sendEmailNotification(
            student.id,
            `Score Published: ${activityName}`,
            `Hi ${student.name || ''},<br>Your score for <b>${activityName}</b> in <b>${courseName}</b> has been published.<br><br>
            <b>Steps to check your score:</b><br>
            1. Go to the home page.<br>
            2. Select the "Grades" option on the sidebar.<br>
            3. Select the "<b>${courseName}</b>".<br>
            4. View the list of all activities and locate the <b>${activityName}</b> to see your score.
            `
          );
        }));
    },
})


export const notifyActivityPosted = task({
  id: 'notify-activity-posted',
  run: async (payload: { courseActivityId: number; runId: string }, params) => { 
    const { courseActivityId, runId } = payload;
    const res = await pool.query(
      `SELECT a.type, a.payload, ca.id as course_activity_id, c.name as course_name, cr.name as run_name, g.name as group_name, cr.group_id
       FROM activities a
       JOIN "course-activities" ca ON ca.activity_id = a.id
       JOIN courses c ON ca.course_id = c.id
       JOIN "course-runs" cr ON cr.id = $2
       JOIN groups g ON cr.group_id = g.id
       WHERE ca.id = $1`, [courseActivityId, runId]
    );
    const row = res.rows[0];
    let activityName = row?.type || 'Activity';
    try {
      const parsed = JSON.parse(row?.payload || '{}');
      if (parsed.name) activityName = parsed.name;
    } catch {}
    const courseName = row?.course_name ;
    const runName = row?.run_name ;
    const groupName = row?.group_name ;
    const groupId = row?.group_id;
    if (!groupId) return;
    const notificationService = new NotificationService(pool);
    const studentsRes = await pool.query(
      `SELECT u.id, u.name FROM "group-members" gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND gm.role = 'student'`, [groupId]
    );
    await Promise.allSettled(studentsRes.rows.map(async (student) => {
      await notificationService.sendPushNotification(student.id, {
        title: `New Activity: ${activityName}`,
        body: `Hi ${student.name || ''}, a new activity "${activityName}" has been added to "${courseName}". Check it out!`,
        data: { courseActivityId, runId }
      });
      await notificationService.sendEmailNotification(student.id,
        `New Activity: ${activityName}`,
        `Hi ${student.name || ''},<br>A new activity <b>${activityName}</b> has been added to <b>${courseName}</b>. Check it out!`
      );
    }));
  }
})

export const notifyRedoEnabled = task({
  id: 'notify-redo-enabled',
  run: async (payload: { userId: string; activityId: number; newDeadline: string }) => {
    const courseActivitiesRes = await pool.query(
      `SELECT ca.id as course_activity_id, c.name as course_name
       FROM "course-activities" ca
       JOIN courses c ON ca.course_id = c.id
       WHERE ca.activity_id = $1`, 
      [payload.activityId]
    );

    if (!courseActivitiesRes.rows.length) {
      console.error(`No course activities found for activity ID: ${payload.activityId}`);
      return;
    }

    const courseActivityId = courseActivitiesRes.rows[0].course_activity_id;
    const result = await pool.query(
      `SELECT a.type, a.payload, ca.order, c.name as course_name, c.id as course_id
       FROM activities a
       JOIN "course-activities" ca ON ca.activity_id = a.id
       JOIN courses c ON ca.course_id = c.id
       WHERE ca.id = $1`, 
      [courseActivityId]
    );
    const activity = result.rows[0];
    if (!activity) {
      console.error(`No activity found for activity ID: ${payload.activityId}`);
      return;
    }

    let activityName = activity?.type;
    try {
      const parsed = JSON.parse(activity?.payload || '{}');
      if (parsed.name) activityName = parsed.name;
    } catch {}
    const courseName = activity.course_name || 'your course';

    const userRes = await pool.query(
      `SELECT name FROM users WHERE id = $1`, 
      [payload.userId]
    );
    const userName = userRes.rows[0]?.name || '';

    const notificationService = new NotificationService(pool);
    
    await notificationService.sendPushNotification(payload.userId, {
      title: `Redo enabled for "${activityName}" in "${courseName}"`,
      body: `Hi ${userName}, redo for activity "${activityName}" is enabled. New deadline: ${payload.newDeadline}.`,
      data: { activityId: payload.activityId.toString(), newDeadline: payload.newDeadline }
    });
    
    await notificationService.sendEmailNotification(
      payload.userId, 
      `Redo enabled for "${activityName}" in "${courseName}"`, 
      `Hi ${userName}, redo for activity "${activityName}" is enabled. New deadline: ${payload.newDeadline}. Please go through the ${courseName} and submit your response.`
    );
  }
});


export const notifyStudentOnAddedToGroup = task({
  id: 'notify-student-added-to-group',
  run: async (payload: { userId: string; groupId: string }) =>  {
    const { userId, groupId } = payload;
    const userRes = await pool.query(
      `SELECT id, name FROM users WHERE id = $1`, [userId]
    );
    const student = userRes.rows[0];
    if (!student) return;

    const groupRes = await pool.query(
      `SELECT g.name as group_name, cr.name as run_name, c.name as course_name
       FROM groups g
       LEFT JOIN "course-runs" cr ON cr.group_id = g.id
       LEFT JOIN courses c ON cr.course_id = c.id
       WHERE g.id = $1`, [groupId]
    );
    const groupName = groupRes.rows[0]?.group_name;
    const runName = groupRes.rows[0]?.run_name;
    const courseName = groupRes.rows[0]?.course_name;
    const notificationService = new NotificationService(pool);
    await notificationService.sendPushNotification(student.id, {
      title: `You've been added to group: ${groupName}`,
      body: `Hi ${student.name || ''}, you have been added to group "${groupName}" for course "${courseName}". Check your dashboard for details!`,
      data: { groupId }
    });
    await notificationService.sendEmailNotification(student.id,
      `You've been added to group: ${groupName}`,
      `Hi ${student.name || ''},<br>You have been added to group <b>${groupName}</b> for course <b>${courseName}</b>. Check your dashboard for details!`
    );
  }
});


export const notifyNewDocumentAdded = task({
  id: 'notify-new-document-added',
  run: async (payload: { runId: string; documentName: string }) => {
    const { runId, documentName } = payload;
    const runRes = await pool.query(
      `SELECT group_id, course_id FROM "course-runs" WHERE id = $1`, [runId]
    );
    const groupId = runRes.rows[0]?.group_id;
    const courseId = runRes.rows[0]?.course_id;
    if (!groupId || !courseId) return;

    const studentsRes = await pool.query(
      `SELECT u.id, u.name FROM "group-members" gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND gm.role = 'student'`, [groupId]
    );
    const managersRes = await pool.query(
      `SELECT u.id, u.name FROM course_managers cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.course_id = $1`, [courseId]
    );
    if (!studentsRes.rows.length && !managersRes.rows.length) return;

    const notificationService = new NotificationService(pool);

    await Promise.allSettled(studentsRes.rows.map(async (student) => {
      await notificationService.sendPushNotification(student.id, {
        title: `New Document Added: ${documentName}`,
        body: `Hi ${student.name || ''}, a new document "${documentName}" has been added to your course. Check it out!`,
        data: { documentName, runId }
      });
      await notificationService.sendEmailNotification(student.id,
        `New Document Added: ${documentName}`,
        `Hi ${student.name || ''},<br>A new document <b>${documentName}</b> has been added to your course. Check it out!`
      );
    }));
    await Promise.allSettled(managersRes.rows.map(async (manager) => {
      await notificationService.sendPushNotification(manager.id, {
        title: `New Document Added: ${documentName}`,
        body: `Hi ${manager.name || ''}, a new document "${documentName}" has been added to your course.`,
        data: { documentName, runId }
      });
      await notificationService.sendEmailNotification(manager.id,
        `New Document Added: ${documentName}`,
        `Hi ${manager.name || ''},<br>A new document <b>${documentName}</b> has been added to your course.`
      );
    }));
  }
});

export const scheduleNotifyMissedDeadline = task({
  id: 'schedule-notify-missed-deadline',
  run: async (payload: { courseActivityId: string; runId: string; deadline: string }) => {
    const { courseActivityId, runId, deadline } = payload;
    
    const activityRes = await pool.query(
      `SELECT a.type FROM activities a
       JOIN "course-activities" ca ON ca.activity_id = a.id
       WHERE ca.id = $1`, [courseActivityId]
    );
    const activityType = activityRes.rows[0]?.type;
    
    if (activityType !== 'quiz' && activityType !== 'assignment') return;
    
    await notifyMissedDeadline.trigger(
      { courseActivityId, runId, deadline },
      { 
        delay: new Date(deadline).toISOString(),
        tags: [`run_${runId}`, `activity_${courseActivityId}`],
        metadata: { runId, courseActivityId, deadline }
      }
    );
  }
});


export const notifyMissedDeadline = task({
  id: 'notify-missed-deadline',
  run: async (payload: { courseActivityId: string; runId: string; deadline: string }) => {
    const { courseActivityId, runId, deadline } = payload;
    const res = await pool.query(
      `SELECT a.type, a.payload, ca.id as course_activity_id, c.name as course_name, cr.name as run_name, g.name as group_name, cr.group_id
       FROM activities a
       JOIN "course-activities" ca ON ca.activity_id = a.id
       JOIN courses c ON ca.course_id = c.id
       JOIN "course-runs" cr ON cr.id = $2
       JOIN groups g ON cr.group_id = g.id
       WHERE ca.id = $1`, [courseActivityId, runId]
    );
    const row = res.rows[0];
    let activityName = row?.type || 'Activity';
    try {
      const parsed = JSON.parse(row?.payload || '{}');
      if (parsed.name) activityName = parsed.name;
    } catch {}
    const courseName = row?.course_name;
    const runName = row?.run_name;
    const groupName = row?.group_name;
    const groupId = row?.group_id;
    if (!groupId) return;
    const studentsRes = await pool.query(
      `SELECT u.id, u.name FROM "group-members" gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND gm.role = 'student'`, [groupId]
    );
    if (!studentsRes.rows.length) return;
    const activityType = row?.type;
    let submittedIds: string[] = [];
    if (activityType === 'assignment') {
      const submissions = await pool.query(
        `SELECT DISTINCT user_id FROM assignment_submissions WHERE activity_id = (SELECT activity_id FROM "course-activities" WHERE id = $1) AND course_run_id = $2`,
        [courseActivityId, runId]
      );
      submittedIds = submissions.rows.map(r => r.user_id);
    } else if (activityType === 'quiz') {
      const attempts = await pool.query(
        `SELECT DISTINCT user_id FROM "quiz-attempts" WHERE activity_id = (SELECT activity_id FROM "course-activities" WHERE id = $1) AND course_run_id = $2`,
        [courseActivityId, runId]
      );
      submittedIds = attempts.rows.map(r => r.user_id);
    }
    const studentsToNotify = studentsRes.rows.filter(s => !submittedIds.includes(s.id));
    if (!studentsToNotify.length) return;
    const notificationService = new NotificationService(pool);
    await Promise.allSettled(studentsToNotify.map(async (student) => {
      await notificationService.sendPushNotification(student.id, {
        title: `Missed Deadline: ${activityName})`,
        body: `Hi ${student.name || ''}, you missed the deadline for "${activityName}" in "${courseName}". Please check with your facilitator for next steps.`,
        data: { courseActivityId, runId, deadline }
      });
      await notificationService.sendEmailNotification(student.id,
        `Missed Deadline: ${activityName})`,
        `Hi ${student.name || ''},<br>You missed the deadline for <b>${activityName}</b> in <b>${courseName}</b>. Please check with your facilitator for next steps.`
      );
    }));
  }
});

export const notifyFacilitatorPostDeadlineSummary = task({
  id: 'notify-facilitator-post-deadline-summary',
  run: async (payload: { courseActivityId: string; runId: string; deadline: string }) => {
    const { courseActivityId, runId, deadline } = payload;
    const runRes = await pool.query(
      `SELECT group_id FROM "course-runs" WHERE id = $1`, [runId]
    );
    const groupId = runRes.rows[0]?.group_id;
    if (!groupId) return;

    const studentsRes = await pool.query(
      `SELECT u.id FROM "group-members" gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND gm.role = 'student'`, [groupId]
    );
    if (!studentsRes.rows.length) return;
    const studentIds = studentsRes.rows.map(s => s.id);

    const res = await pool.query(
      `SELECT a.type, a.payload, ca.id as course_activity_id, c.name as course_name, cr.name as run_name, g.name as group_name, cr.group_id as group_id_ctx
       FROM activities a
       JOIN "course-activities" ca ON ca.activity_id = a.id
       JOIN courses c ON ca.course_id = c.id
       JOIN "course-runs" cr ON cr.id = $2
       JOIN groups g ON cr.group_id = g.id
       WHERE ca.id = $1`, [courseActivityId, runId]
    );
    const row = res.rows[0];
    let activityName = row?.type || 'Activity';
    try {
      const parsed = JSON.parse(row?.payload || '{}');
      if (parsed.name) activityName = parsed.name;
    } catch {}
    const courseName = row?.course_name;
    const runName = row?.run_name;
    const groupName = row?.group_name;
    const groupId_ctx = row?.group_id_ctx;
    if (!groupId_ctx) return;
    const studentsRes_ctx = await pool.query(
      `SELECT u.id FROM "group-members" gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1 AND gm.role = 'student'`, [groupId_ctx]
    );
    if (!studentsRes_ctx.rows.length) return;
    const studentIds_ctx = studentsRes_ctx.rows.map(s => s.id);
    const activityType = row?.type;
    let submittedIds: string[] = [];
    if (activityType === 'assignment') {
      const submissions = await pool.query(
        `SELECT DISTINCT user_id FROM assignment_submissions WHERE activity_id = (SELECT activity_id FROM "course-activities" WHERE id = $1) AND course_run_id = $2`,
        [courseActivityId, runId]
      );
      submittedIds = submissions.rows.map(r => r.user_id);
    } else if (activityType === 'quiz') {
      const attempts = await pool.query(
        `SELECT DISTINCT user_id FROM "quiz-attempts" WHERE activity_id = (SELECT activity_id FROM "course-activities" WHERE id = $1) AND course_run_id = $2`,
        [courseActivityId, runId]
      );
      submittedIds = attempts.rows.map(r => r.user_id);
    }
    const submitted = studentIds_ctx.filter(id => submittedIds.includes(id)).length;
    const notSubmitted = studentIds_ctx.length - submitted;
    const courseId = await (async () => {
      const courseRes = await pool.query(
        `SELECT course_id FROM "course-activities" WHERE id = $1`, [courseActivityId]
      );
      return courseRes.rows[0]?.course_id;
    })();
    if (!courseId) return;
    const facilitatorsRes = await pool.query(
      `SELECT u.id, u.name FROM course_managers cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.course_id = $1`, [courseId]
    );
    if (!facilitatorsRes.rows.length) return;
    const notificationService = new NotificationService(pool);
    await Promise.allSettled(facilitatorsRes.rows.map(async (facilitator) => {
      await notificationService.sendPushNotification(facilitator.id, {
        title: `Graded activity deadline passed: ${activityName})`,
        body: `Activity "${activityName}" in "${courseName}" deadline passed. Submitted: ${submitted}, Not submitted: ${notSubmitted}`,
        data: { courseActivityId, submitted, notSubmitted }
      });
      await notificationService.sendEmailNotification(
        facilitator.id,
        `Graded Activity Deadline Passed: ${activityName})`,
        `Dear ${facilitator.name},<br><br>
        The deadline for the graded activity <b>${activityName}</b> in the course <b>${courseName}</b> has passed.<br>
        <b>Number of students who submitted:</b> ${submitted}<br>
        <b>Number of students who did not submit:</b> ${notSubmitted}<br><br>
        Please review the submissions and follow up with students as needed.<br><br>
        `
      );
    }));
  }
});

export const scheduleNotifyFacilitatorPostDeadlineSummary = task({
  id: 'schedule-notify-facilitator-post-deadline-summary',
  run: async (payload: { courseActivityId: string; runId: string; deadline: string }) => {
    const { courseActivityId, runId, deadline } = payload;
    
    const activityRes = await pool.query(
      `SELECT a.type FROM activities a
       JOIN "course-activities" ca ON ca.activity_id = a.id
       WHERE ca.id = $1`, [courseActivityId]
    );
    const activityType = activityRes.rows[0]?.type;
    
    if (activityType !== 'quiz' && activityType !== 'assignment') return;
    
    await notifyFacilitatorPostDeadlineSummary.trigger(
      { courseActivityId, runId, deadline },
      { 
        delay: new Date(deadline).toISOString(),
        tags: [`run_${runId}`, `activity_${courseActivityId}`],
        metadata: { runId, courseActivityId, deadline, activityType }
      }
    );
  }
});


export const notifyFacilitatorEndOfCourseRunFinalize = task({
  id: 'notify-facilitator-end-of-course-run-finalize',
  run: async (payload: { courseRunId: string }) => {
    const { courseRunId } = payload;
    const res = await pool.query(
      `SELECT cr.name as run_name, c.name as course_name, g.name as group_name
       FROM "course-runs" cr
       JOIN courses c ON cr.course_id = c.id
       JOIN groups g ON cr.group_id = g.id
       WHERE cr.id = $1`, [courseRunId]
    );
    const row = res.rows[0];
    const runName = row?.run_name;
    const courseName = row?.course_name;
    const groupName = row?.group_name;
    const facilitatorsRes = await pool.query(
      `SELECT u.id, u.name FROM course_managers cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.course_id = (SELECT course_id FROM "course-runs" WHERE id = $1)`, [courseRunId]
    );
    if (!facilitatorsRes.rows.length) return;
    const notificationService = new NotificationService(pool);
    await Promise.allSettled(facilitatorsRes.rows.map(async (facilitator) => {
      await notificationService.sendPushNotification(facilitator.id, {
        title: `Course run finalized: ${runName})`,
        body: `The course run "${runName}" for course "${courseName}" has been finalized. Please check the dashboard for details.`,
        data: { courseRunId }
      });
      await notificationService.sendEmailNotification(facilitator.id,
        `Course run finalized: ${runName})`,
        `The course run <b>${runName}</b> for course <b>${courseName}</b> has been finalized. Please check the dashboard for details.`
      );
    }));
  }
});

export const scheduleNotifyFacilitatorEndOfCourseRunFinalize = task({
  id: 'schedule-notify-facilitator-end-of-course-run-finalize',
  run: async (payload: { courseRunId: string }) => {
    const { courseRunId } = payload;
    const runRes = await pool.query(
      `SELECT end_date FROM "course-runs" WHERE id = $1`, [courseRunId]
    );
    const endDate = runRes.rows[0]?.end_date;
    await notifyFacilitatorEndOfCourseRunFinalize.trigger(
      { courseRunId },
      { delay: new Date(endDate).toISOString(),
        tags: [`run_${courseRunId}`],
        metadata: { courseRunId, endDate }
       }
    );
  }
});
