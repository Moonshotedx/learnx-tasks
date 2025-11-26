interface EmailTemplateParams {
  heading: string;
  subheading: string;
  body: string;
  ctaText?: string;
  ctaUrl?: string;
}

export function generateEmailTemplate({
  heading,
  subheading,
  body,
  ctaText = "Go to LearnX",
  ctaUrl = "https://learnx.atriauniversity.in"
}: EmailTemplateParams): string {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${heading}</title>
    <style>
        @media only screen and (max-width: 600px) {
            .logo-icon {
                width: 32px !important;
                height: 32px !important;
            }
            .logo-text {
                font-size: 20px !important;
            }
            .au-logo {
                width: 90px !important;
            }
            .header-padding {
                padding: 15px !important;
            }
            .logo-left {
                text-align: left !important;
                width: 50% !important;
                display: table-cell !important;
            }
            .logo-right {
    text-align: right !important;
    width: 100% !important;
    display: block !important;
}
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f2f2f2; font-family: Arial, sans-serif;">
    <table width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="#f2f2f2">
        <tr>
            <td align="center" style="padding: 30px 15px;">
                <!-- Main Container -->
                <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border: 8px solid #d9d9d9;">
                    
                    <!-- Header with Logos -->
                    <tr>
                        <td class="header-padding" style="padding: 20px;">
                            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                                <tr>
                                    <!-- Left side: Logo + LearnX -->
                                    <td class="logo-left" style="text-align: left; vertical-align: middle; width: 50%;">
                                        <table cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
                                            <tr>
                                                <td>
                                                    <img src="https://bucket.xcelerator.co.in/maskable-icon-192.png"
                                                         alt="LearnX Logo"
                                                         class="logo-icon"
                                                         style="display: inline-block; width: 32px; height: 32px; margin-right: 8px;">
                                                </td>
                                                <td style="vertical-align: middle;">
                                                    <h1 class="logo-text" style="font-size: 20px; margin: 0; font-family: Arial, sans-serif; font-weight: bold;">
                                                        LearnX
                                                    </h1>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>

                                    <!-- Right side: AU Logo -->
                                    <td class="logo-right" style="text-align: right; vertical-align: middle; width: 50%;">
                                        <img src="https://assets.xcelerator.co.in/AUFull.png"
                                             alt="AU Logo"
                                             class="au-logo"
                                             style="display: inline-block; width: 100px; height: auto; max-width: 100%;">
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Header Section with Heading and Subheading -->
                    <tr>
                        <td style="background-color: #625A96; color: #ffffff; text-align: left; padding: 40px;">
                            <h1 style="margin: 0; font-size: 30px; font-weight: bold;">${heading}</h1>
                            <p style="margin: 15px 0 0; font-size: 20px;">${subheading}</p>
                        </td>
                    </tr>
                    
                    <!-- Content Section -->
                    <tr>
                        <td style="padding: 40px 50px; color: #333333; font-size: 16px; line-height: 28px;">
                            ${body}
                            
                            <div style="text-align: left; margin: 30px 0;">
                                <a href="${ctaUrl}" 
                                   style="display: inline-block; padding: 15px 30px; background-color: #625A96; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                                    ${ctaText}
                                </a>
                            </div>
                            
                            <p style="margin-top: 30px; margin-bottom: 20px;">
                                For any assistance, contact us at <a href="mailto:support@xcelerator.co.in" style="color: #625A96;">support@xcelerator.co.in</a>.
                            </p>
                            
                            <p style="font-weight: bold; margin-top: 30px;">Regards,<br>Team Xcelerator</p>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
  `.trim();
}

// Email template configurations based on email-template.md
export const emailTemplates = {
  activityPosted: (activityName: string, runName: string) => ({
    subject: "New Activity Available in Your Course Run",
    heading: "A New Activity Awaits You",
    subheading: "Stay on track and keep learning.",
    body: `
      <p style="margin-bottom: 15px;">Hello,</p>
      <p style="margin-bottom: 15px;">A new activity <strong>${activityName}</strong> has been added to <strong>${runName}</strong>.</p>
      <p>Visit your dashboard to check it out and continue your learning journey.</p>
    `
  }),

  addedToGroup: (groupName: string) => ({
    subject: "You've Been Added to a Group",
    heading: "Group Access Granted",
    subheading: "Stay organized with your course activities.",
    body: `
      <p style="margin-bottom: 15px;">Hello,</p>
      <p style="margin-bottom: 15px;">You've been added to the group <strong>${groupName}</strong>.</p>
      <p>Visit your dashboard to view group details.</p>
    `
  }),

  deadlineSoon: (activityName: string, runName: string, deadline: string) => ({
    subject: "Upcoming Activity Deadline",
    heading: "Your Activity is Due Soon",
    subheading: "Submit before the deadline to stay on track.",
    body: `
      <p style="margin-bottom: 15px;">Hello,</p>
      <p style="margin-bottom: 15px;">Your activity <strong>${activityName}</strong> for <strong>${runName}</strong> is due on <strong>${deadline}</strong>.</p>
      <p>Please ensure you submit it before the deadline.</p>
    `
  }),

  newDocument: (documentName: string, courseName: string) => ({
    subject: "New Document Available in Your Course",
    heading: "A New Resource Has Been Shared",
    subheading: "Access the latest material for your course.",
    body: `
      <p style="margin-bottom: 15px;">Hello,</p>
      <p style="margin-bottom: 15px;">A new document <strong>${documentName}</strong> has been added to <strong>${courseName}</strong>.</p>
      <p>Visit your dashboard to review it.</p>
    `
  }),

  adminDeadline: (activityName: string, runName: string, deadline: string) => ({
    subject: "Upcoming Deadline in Your Course Run",
    heading: "Activity Deadline Approaching",
    subheading: "Monitor learner progress closely.",
    body: `
      <p style="margin-bottom: 15px;">Hello,</p>
      <p style="margin-bottom: 15px;">The activity <strong>${activityName}</strong> in <strong>${runName}</strong> is due in 30 minutes (at <strong>${deadline}</strong>).</p>
      <p>Please ensure learners are on track.</p>
    `
  }),

  redoEnabled: (activityName: string, deadline: string, courseInfo: string) => ({
    subject: "Redo Enabled for Your Activity",
    heading: "You Can Redo Your Activity",
    subheading: "A new chance to complete your work.",
    body: `
      <p style="margin-bottom: 15px;">Hello,</p>
      <p style="margin-bottom: 10px;">Redo has been enabled for <strong>${activityName}</strong>.</p>
      <p style="margin-bottom: 15px;">Your new submission deadline is <strong>${deadline}</strong>.</p>
      <p>Please go through the <strong>${courseInfo}</strong> and submit your response.</p>
    `
  }),

  scorePublished: (activityName: string, runName: string) => ({
    subject: "Your Score is Now Available",
    heading: "Score Published for Your Activity",
    subheading: "Review your performance in the course.",
    body: `
      <p style="margin-bottom: 15px;">Hello,</p>
      <p style="margin-bottom: 15px;">Your score for <strong>${activityName}</strong> in <strong>${runName}</strong> has been published.</p>
      <p style="margin-bottom: 15px; font-weight: bold;">How to check your score:</p>
      <ol style="margin-bottom: 0; padding-left: 20px;">
        <li style="margin-bottom: 8px;">Go to the home page.</li>
        <li style="margin-bottom: 8px;">Select the <strong>Grades</strong> option in the sidebar.</li>
        <li style="margin-bottom: 8px;">Choose the appropriate course run.</li>
        <li>Find the <strong>${activityName}</strong> in the list to view your score.</li>
      </ol>
    `
  }),

  missedDeadline: (activityName: string, runName: string) => ({
    subject: "Missed Deadline Notification",
    heading: "You Missed a Deadline",
    subheading: "Please contact your instructor for next steps.",
    body: `
      <p style="margin-bottom: 15px;">Hello,</p>
      <p style="margin-bottom: 15px;">You missed the deadline for <strong>${activityName}</strong> in <strong>${runName}</strong>.</p>
      <p>Please reach out to your instructor for guidance on how to proceed.</p>
    `
  }),

  facilitatorSummary: (activityName: string, runName: string, submitted: number, notSubmitted: number) => ({
    subject: "Post-Deadline Summary for Your Course Run",
    heading: "Activity Deadline Summary",
    subheading: "Review student submission status.",
    body: `
      <p style="margin-bottom: 15px;">Hello,</p>
      <p style="margin-bottom: 15px;">The deadline for <strong>${activityName}</strong> in <strong>${runName}</strong> has passed.</p>
      <p style="margin-bottom: 15px;"><strong>Submission Summary:</strong></p>
      <ul style="margin-bottom: 15px; padding-left: 20px;">
        <li style="margin-bottom: 8px;">Students who submitted: <strong>${submitted}</strong></li>
        <li>Students who did not submit: <strong>${notSubmitted}</strong></li>
      </ul>
      <p>Please review and take necessary actions.</p>
    `
  }),

  courseRunFinalize: (courseName: string, runName: string, endDate: string) => ({
    subject: "Course Run Ending Soon - Action Required",
    heading: "Time to Finalize Your Course Run",
    subheading: "Ensure all grading is completed.",
    body: `
      <p style="margin-bottom: 15px;">Hello,</p>
      <p style="margin-bottom: 15px;">The course run <strong>${runName}</strong> for <strong>${courseName}</strong> is ending on <strong>${endDate}</strong>.</p>
      <p>Please ensure all activities are graded and finalized before the end date.</p>
    `
  })
};
