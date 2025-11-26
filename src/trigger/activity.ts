import { task } from '@trigger.dev/sdk/v3';
import pool from '../lib/db';

export const scheduleAutoSubmitUnsubmittedActivities = task({
    id: 'schedule-auto-submit-unsubmitted-activities',
    run: async (payload: {
        courseActivityId: number;
        runId: number;
        deadline: string;
    }) => {
        // Get activity type
        const activityRes = await pool.query(
            `SELECT a.id as activity_id, a.type FROM activities a
       JOIN "course-activities" ca ON ca.activity_id = a.id
       WHERE ca.id = $1`,
            [payload.courseActivityId],
        );

        if (!activityRes.rows.length) {
            throw new Error(
                `Activity not found for courseActivityId: ${payload.courseActivityId}`,
            );
        }

        const activityType = activityRes.rows[0].type;
        const activityId = activityRes.rows[0].activity_id;

        if (activityType !== 'quiz' && activityType !== 'exam') {
            console.log(
                `Skipping auto-submit scheduling for activity type: ${activityType}, courseActivityId: ${payload.courseActivityId}`,
            );
            return;
        }

        // Schedule the auto-submit task to run at the deadline
        await autoSubmitUnsubmittedActivities.trigger(
            {
                activityId: activityId,
                activityType: activityType,
                runId: payload.runId,
                deadline: payload.deadline,
            },
            {
                delay: new Date(payload.deadline).toISOString(),
                tags: [
                    `run_${payload.runId}`,
                    `activity_${payload.courseActivityId}`,
                    'auto_submit',
                ],
                metadata: {
                    runId: payload.runId,
                    courseActivityId: payload.courseActivityId,
                    activityType: activityType,
                    deadline: payload.deadline,
                    type: 'auto_submit_unsubmitted',
                },
            },
        );
    },
});

export const autoSubmitUnsubmittedActivities = task({
    id: 'auto-submit-unsubmitted-activities',
    run: async (payload: {
        activityId: number;
        activityType: string;
        runId: number;
        deadline: string;
    }) => {
        const { activityId, activityType, runId } = payload;
        const now = new Date();

        if (activityType === 'quiz') {
            // Update quiz attempts where completedAt is null
            const updateResult = await pool.query(
                `UPDATE "quiz-attempts"
         SET completed_at = $1
         WHERE activity_id = $2
         AND course_run_id = $3
         AND completed_at IS NULL
         RETURNING id, user_id`,
                [now, activityId, runId],
            );


            return {
                success: true,
                activityType: 'quiz',
                updatedCount: updateResult.rowCount || 0,
                updatedUsers: updateResult.rows.map((r) => r.user_id),
            };
        } else if (activityType === 'exam') {
            // Update exam submissions where submittedAt is null
            const updateResult = await pool.query(
                `UPDATE exam_submissions
         SET submitted_at = $1, updated_at = $1
         WHERE activity_id = $2
         AND course_run_id = $3
         AND submitted_at IS NULL
         RETURNING id, user_id`,
                [now, activityId, runId],
            );

            return {
                success: true,
                activityType: 'exam',
                updatedCount: updateResult.rowCount || 0,
                updatedUsers: updateResult.rows.map((r) => r.user_id),
            };
        } else {
            console.log(
                `Skipping auto-submit for unsupported activity type: ${activityType}`,
            );
            return {
                success: false,
                message: `Unsupported activity type: ${activityType}`,
            };
        }
    },
});

export const scheduleAutoSubmitStudentRedo = task({
    id: 'schedule-auto-submit-student-redo',
    run: async (payload: {
        userId: string;
        courseActivityId: number;
        runId: number;
        deadline: string;
    }) => {
        const activityRes = await pool.query(
            `SELECT a.id as activity_id, a.type FROM activities a
       JOIN "course-activities" ca ON ca.activity_id = a.id
       WHERE ca.id = $1`,
            [payload.courseActivityId],
        );

        if (!activityRes.rows.length) {
            throw new Error(
                `Activity not found for courseActivityId: ${payload.courseActivityId}`,
            );
        }

        const activityType = activityRes.rows[0].type;
        const activityId = activityRes.rows[0].activity_id;

        if (activityType !== 'quiz' && activityType !== 'exam') {
            console.log(
                `Skipping student auto-submit scheduling for activity type: ${activityType}, courseActivityId: ${payload.courseActivityId}, userId: ${payload.userId}`,
            );
            return;
        }

        await autoSubmitStudentRedo.trigger(
            {
                userId: payload.userId,
                activityId: activityId,
                activityType: activityType,
                runId: payload.runId,
                deadline: payload.deadline,
            },
            {
                delay: new Date(payload.deadline).toISOString(),
                tags: [
                    `run_${payload.runId}`,
                    `activity_${payload.courseActivityId}`,
                    `user_${payload.userId}`,
                    'auto_submit_redo',
                ],
                metadata: {
                    userId: payload.userId,
                    runId: payload.runId,
                    courseActivityId: payload.courseActivityId,
                    activityType: activityType,
                    deadline: payload.deadline,
                    type: 'auto_submit_student_redo',
                },
            },
        );
    },
});

export const autoSubmitStudentRedo = task({
    id: 'auto-submit-student-redo',
    run: async (payload: {
        userId: string;
        activityId: number;
        activityType: string;
        runId: number;
        deadline: string;
    }) => {
        const { userId, activityId, activityType, runId } = payload;
        const now = new Date();

        if (activityType === 'quiz') {
            const updateResult = await pool.query(
                `UPDATE "quiz-attempts"
         SET completed_at = $1
         WHERE activity_id = $2
         AND course_run_id = $3
         AND user_id = $4
         AND completed_at IS NULL
         RETURNING id, user_id`,
                [now, activityId, runId, userId],
            );

            return {
                success: true,
                activityType: 'quiz',
                userId: userId,
                updatedCount: updateResult.rowCount || 0,
                message: `Auto-submitted quiz attempt for user ${userId}`,
            };
        } else if (activityType === 'exam') {
            const updateResult = await pool.query(
                `UPDATE exam_submissions
         SET submitted_at = $1, updated_at = $1
         WHERE activity_id = $2
         AND course_run_id = $3
         AND user_id = $4
         AND submitted_at IS NULL
         RETURNING id, user_id`,
                [now, activityId, runId, userId],
            );

            return {
                success: true,
                activityType: 'exam',
                userId: userId,
                updatedCount: updateResult.rowCount || 0,
                message: `Auto-submitted exam for user ${userId}`,
            };
        } else {
            console.log(
                `Skipping student auto-submit for unsupported activity type: ${activityType}`,
            );
            return {
                success: false,
                message: `Unsupported activity type: ${activityType}`,
            };
        }
    },
});
