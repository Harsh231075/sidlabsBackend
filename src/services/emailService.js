const nodemailer = require('nodemailer');

function getEmailConfigSummary() {
  const portRaw = process.env.SMTP_PORT || '587';
  const port = Number.parseInt(portRaw, 10);
  const fromEmail = process.env.FROM_EMAIL;
  const fromName = process.env.FROM_NAME || 'Winsights';

  return {
    smtpHost: process.env.SMTP_HOST,
    smtpPort: Number.isFinite(port) ? port : 587,
    smtpUser: process.env.SMTP_USER,
    hasSmtpPass: Boolean(process.env.SMTP_PASS),
    fromEmail,
    fromName,
    hasFromEmail: Boolean(fromEmail),
  };
}

function getEmailConfigProblems() {
  const cfg = getEmailConfigSummary();
  const problems = [];
  if (!cfg.smtpHost) problems.push('SMTP_HOST is missing');
  if (!cfg.smtpPort) problems.push('SMTP_PORT is missing/invalid');
  if (!cfg.smtpUser) problems.push('SMTP_USER is missing');
  if (!cfg.hasSmtpPass) problems.push('SMTP_PASS is missing');
  if (!cfg.fromEmail) problems.push('FROM_EMAIL is missing');
  return { cfg, problems };
}

// Initialize transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify connection configuration
transporter.verify(function (error) {
  if (error) {
    console.error('SMTP Connection Error:', error);
  } else {
    console.log('SMTP Server is ready to take messages');
  }
});

const defaultFrom = `"${process.env.FROM_NAME || 'Winsights'}" <${process.env.FROM_EMAIL}>`;

// Generic send function
async function sendEmail({ to, subject, html }) {
  if (!to) return null;

  const { problems } = getEmailConfigProblems();
  if (problems.length) {
    console.error('Email config invalid:', problems.join('; '));
    return null;
  }

  try {
    const info = await transporter.sendMail({
      from: defaultFrom,
      to,
      subject,
      html,
    });
    console.log(`Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`Error sending email to ${to}:`, error);
    return null;
  }
}

async function verifyEmailTransport() {
  const { cfg, problems } = getEmailConfigProblems();
  if (problems.length) {
    return { ok: false, problems, cfg };
  }

  try {
    await transporter.verify();
    return { ok: true, problems: [], cfg };
  } catch (err) {
    return {
      ok: false,
      problems: ['SMTP verify failed'],
      cfg,
      error: {
        message: err?.message || String(err),
        code: err?.code,
      },
    };
  }
}

async function sendTestEmail(to) {
  const html = `
    <div style="font-family: Arial, sans-serif; color: #111;">
      <h2 style="margin: 0 0 12px;">Winsights Email Test ✅</h2>
      <p style="margin: 0 0 8px;">If you're reading this, SMTP is configured correctly.</p>
      <p style="margin: 0 0 8px; color: #555;">Sent at: ${new Date().toISOString()}</p>
      <p style="margin: 0; color: #555;">Environment: ${process.env.NODE_ENV || 'development'}</p>
    </div>
  `;

  const info = await sendEmail({
    to,
    subject: 'Winsights SMTP Test',
    html,
  });

  return {
    ok: Boolean(info),
    messageId: info?.messageId,
    accepted: info?.accepted,
    rejected: info?.rejected,
  };
}

// Templates

/**
 * Send Welcome Email based on role
 * Criteria: Sent to all new users upon registration
 */
async function sendWelcomeEmail(user) {
  const { email, name, roleType } = user;

  let subject = 'Welcome to Winsights Social!';
  let content = '';

  if (roleType === 'patient') {
    subject = 'Welcome to Winsights Social - Your Community Awaits';
    content = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Hello ${name},</h2>
        <p>Welcome to <strong>Winsights Social</strong>! We are thrilled to have you join our community.</p>
        <p>Here you can connect with others, share your experiences, and find support.</p>
        <ul>
          <li>Create your profile</li>
          <li>Join disease-specific groups</li>
          <li>Share your story</li>
        </ul>
        <p>If you have any questions, feel free to reply to this email.</p>
        <p>Best regards,<br/>The Winsights Team</p>
      </div>
    `;
  } else if (roleType === 'moderator') {
    subject = 'Welcome to Winsights Social - Moderator Access';
    content = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Hello ${name},</h2>
        <p>Welcome to the <strong>Winsights Social</strong> team as a <strong>Moderator</strong>.</p>
        <p>Thank you for helping us keep our community safe and supportive.</p>
        <p>You now have access to moderation tools to review content and manage reports.</p>
        <p>Best regards,<br/>The Winsights Team</p>
      </div>
    `;
  } else if (roleType === 'admin') {
    subject = 'Welcome to Winsights Social - Admin Access';
    content = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Hello ${name},</h2>
        <p>Your <strong>Admin</strong> account for <strong>Winsights Social</strong> is now active.</p>
        <p>You have full access to system settings, user management, and moderation queues.</p>
        <br/>
        <p>Please ensure you keep your credentials secure.</p>
        <p>Best regards,<br/>The Winsights Team</p>
      </div>
    `;
  } else {
    // Fallback
    content = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Hello ${name},</h2>
        <p>Welcome to <strong>Winsights Social</strong>!</p>
        <p>We are excited to have you on board.</p>
        <p>Best regards,<br/>The Winsights Team</p>
      </div>
    `;
  }

  return sendEmail({ to: email, subject, html: content });
}

/**
 * Send Friend Request Email
 * Trigger: When User A sends a friend request to User B
 */
async function sendFriendRequestEmail({ fromUser, toUser }) {
  if (!toUser || !toUser.email) return;

  const subject = `New Friend Request from ${fromUser.name}`;
  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #4F46E5; font-size: 24px; margin: 0;">Winsights Social</h1>
      </div>
      <div style="background-color: #ffffff; padding: 20px;">
        <h2 style="color: #111827; margin-top: 0;">Hello ${toUser.name},</h2>
        <p style="font-size: 16px; line-height: 1.5; color: #4B5563;">
          <strong>${fromUser.name}</strong> wants to be friends with you on Winsights Social.
        </p>
        <p style="font-size: 16px; line-height: 1.5; color: #4B5563;">
          Log in to view their profile and accept the request.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.CLIENT_URL || '#'}/friends" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">View Request</a>
        </div>
        <p style="font-size: 14px; color: #6B7280; margin-top: 24px; border-top: 1px solid #eee; padding-top: 20px;">
          Best regards,<br/>The Winsights Team
        </p>
      </div>
    </div>
  `;

  return sendEmail({ to: toUser.email, subject, html });
}

/**
 * Send Notification to Moderators about Flagged Content
 * Criteria: Sent when content is flagged/quarantined (High Severity)
 */
async function sendModerationAlert({ contentType, contentId, reason, flaggedBy }) {
  try {
    const User = require('../models/User'); // Lazy load to avoid circular deps if any

    // Find all admins and moderators
    const recipients = await User.find({
      roleType: { $in: ['admin', 'moderator'] },
      email: { $exists: true, $ne: '' }
    }).select('email');

    if (!recipients.length) {
      console.log('No moderators/admins found to email.');
      // Fallback to system email if no users found
      const systemEmail = process.env.FROM_EMAIL;
      return sendEmail({
        to: systemEmail,
        subject: `[System Alert] Content Flagged: ${contentType}`,
        html: generateModerationEmailHtml({ contentType, contentId, reason, flaggedBy })
      });
    }

    const emailPromises = recipients.map(user => {
      const subject = `[Action Required] Content Flagged: ${contentType}`;
      const html = generateModerationEmailHtml({ contentType, contentId, reason, flaggedBy });
      return sendEmail({ to: user.email, subject, html });
    });

    return Promise.all(emailPromises);
  } catch (error) {
    console.error('Error sending moderation alerts:', error);
  }
}

function generateModerationEmailHtml({ contentType, contentId, reason, flaggedBy }) {
  return `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #DC2626; font-size: 24px; margin: 0;">Moderation Alert</h1>
      </div>
      <div style="background-color: #FEF2F2; padding: 20px; border-radius: 6px; border: 1px solid #FCA5A5;">
        <p style="font-size: 16px; line-height: 1.5; color: #991B1B; margin-top: 0;">
          <strong>Attention:</strong> New content has been flagged as sensitive or unsafe.
        </p>
        <ul style="background-color: #ffffff; padding: 15px 15px 15px 30px; border-radius: 4px; border: 1px solid #FEE2E2;">
          <li style="margin-bottom: 8px;"><strong>Type:</strong> ${contentType}</li>
          <li style="margin-bottom: 8px;"><strong>ID:</strong> ${contentId}</li>
          <li style="margin-bottom: 8px;"><strong>Reason:</strong> ${reason}</li>
          <li><strong>Flagged By User ID:</strong> ${flaggedBy}</li>
        </ul>
        <p style="font-size: 16px; margin-top: 20px;">Please visit the moderation dashboard to review immediately.</p>
        <div style="text-align: center; margin: 25px 0 10px;">
           <a href="${process.env.CLIENT_URL || '#'}/admin/moderation" style="background-color: #DC2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Review Content</a>
        </div>
      </div>
    </div>
  `;
}

/**
 * Send Friend Request Accepted Email
 * Trigger: When User B accepts User A's friend request
 */
async function sendFriendRequestAcceptedEmail({ sender, recipient }) {
  // sender: The person who SENT the original request (User A) - they get the notification now
  // recipient: The person who ACCEPTED the request (User B)
  if (!sender || !sender.email) return;

  const subject = `${recipient.name} accepted your friend request`;
  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #4F46E5; font-size: 24px; margin: 0;">Winsights Social</h1>
      </div>
      <div style="background-color: #ffffff; padding: 20px;">
        <h2 style="color: #111827; margin-top: 0;">Good news, ${sender.name}!</h2>
        <p style="font-size: 16px; line-height: 1.5; color: #4B5563;">
          <strong>${recipient.name}</strong> has accepted your friend request.
        </p>
        <p style="font-size: 16px; line-height: 1.5; color: #4B5563;">
          You can now see their updates and interact with them on Winsights Social.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.CLIENT_URL || '#'}/profile/${recipient.username || recipient._id}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Visit Profile</a>
        </div>
        <p style="font-size: 14px; color: #6B7280; margin-top: 24px; border-top: 1px solid #eee; padding-top: 20px;">
          Best regards,<br/>The Winsights Team
        </p>
      </div>
    </div>
  `;

  return sendEmail({ to: sender.email, subject, html });
}

/**
 * Notify Post Author about Removal
 */
async function sendContentRemovedEmailToAuthor({ authorName, authorEmail, contentSummary, reason }) {
  if (!authorEmail) return;
  const subject = 'Your content was removed from Winsights Social';
  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #4F46E5; font-size: 24px; margin: 0;">Winsights Social</h1>
      </div>
      <div style="background-color: #ffffff; padding: 20px;">
        <h2 style="color: #111827; margin-top: 0;">Hello ${authorName},</h2>
        <p style="font-size: 16px; line-height: 1.5; color: #4B5563;">
          We are writing to let you know that some of your content was removed from Winsights Social because it violated our Community Guidelines.
        </p>
        <div style="background-color: #F3F4F6; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #EF4444;">
           <p style="margin: 0 0 10px; font-size: 15px;"><strong>Content Snippet:</strong><br/> <span style="color: #6B7280;">"${contentSummary || 'User content'}"</span></p>
           <p style="margin: 0; font-size: 15px;"><strong>Reason:</strong><br/> ${reason || 'Violation of terms'}</p>
        </div>
        <p style="font-size: 16px; line-height: 1.5; color: #4B5563;">
          Please review our guidelines to ensure your future posts are compliant.
        </p>
        <p style="font-size: 14px; color: #6B7280; margin-top: 24px; border-top: 1px solid #eee; padding-top: 20px;">
          Best regards,<br/>The Winsights Moderation Team
        </p>
      </div>
    </div>
  `;
  return sendEmail({ to: authorEmail, subject, html });
}

/**
 * Notify Reporter about Removal (Action Taken)
 */
async function sendContentRemovedEmailToReporter({ reporterName, reporterEmail, contentSummary }) {
  if (!reporterEmail) return;
  const subject = 'Update on your report';
  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #4F46E5; font-size: 24px; margin: 0;">Winsights Social</h1>
      </div>
      <div style="background-color: #ffffff; padding: 20px;">
        <h2 style="color: #111827; margin-top: 0;">Hello ${reporterName},</h2>
        <p style="font-size: 16px; line-height: 1.5; color: #4B5563;">
          Thank you for reporting content that you believed violated our Community Guidelines.
        </p>
        <p style="font-size: 16px; line-height: 1.5; color: #059669; font-weight: bold;">
          We have reviewed your report and removed the content.
        </p>
        <div style="background-color: #F3F4F6; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #10B981;">
           <p style="margin: 0 0 10px; font-size: 15px;"><strong>Content Snippet:</strong><br/> <span style="color: #6B7280;">"${contentSummary || 'Reported content'}"</span></p>
           <p style="margin: 0; font-size: 15px;"><strong>Action Taken:</strong> Removed</p>
        </div>
        <p style="font-size: 16px; line-height: 1.5; color: #4B5563;">
          Thank you for helping keep the Winsights Social community safe.
        </p>
        <p style="font-size: 14px; color: #6B7280; margin-top: 24px; border-top: 1px solid #eee; padding-top: 20px;">
          Best regards,<br/>The Winsights Moderation Team
        </p>
      </div>
    </div>
  `;
  return sendEmail({ to: reporterEmail, subject, html });
}

/**
 * Notify Reporter that content was kept (Approved/Allowed)
 */
async function sendContentApprovedEmailToReporter({ reporterName, reporterEmail, contentSummary }) {
  if (!reporterEmail) return;
  const subject = 'Update on your report';
  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #4F46E5; font-size: 24px; margin: 0;">Winsights Social</h1>
      </div>
      <div style="background-color: #ffffff; padding: 20px;">
        <h2 style="color: #111827; margin-top: 0;">Hello ${reporterName},</h2>
        <p style="font-size: 16px; line-height: 1.5; color: #4B5563;">
          Thank you for reporting content to us. We wanted to let you know that we have reviewed the content you flagged.
        </p>
        <div style="background-color: #F3F4F6; padding: 20px; border-radius: 6px; margin: 20px 0;">
           <p style="margin: 0; font-size: 15px;"><strong>Content Snippet:</strong><br/> <span style="color: #6B7280;">"${contentSummary || 'Reported content'}"</span></p>
        </div>
        <p style="font-size: 16px; line-height: 1.5; color: #4B5563;">
          We found that this content <strong>does not violate</strong> our Community Guidelines currently. We understand this may be frustrating, but we permit a wide range of views as long as they don't break our rules.
        </p>
        <p style="font-size: 16px; line-height: 1.5; color: #4B5563;">
          If you still find this content offensive, you can unfollow or block the author to hide their posts.
        </p>
        <p style="font-size: 14px; color: #6B7280; margin-top: 24px; border-top: 1px solid #eee; padding-top: 20px;">
          Best regards,<br/>The Winsights Moderation Team
        </p>
      </div>
    </div>
  `;
  return sendEmail({ to: reporterEmail, subject, html });
}

/**
 * Notify Author that content was restored/approved (if it was previously hidden/quarantined)
 */
async function sendContentApprovedEmailToAuthor({ authorName, authorEmail, contentSummary }) {
  if (!authorEmail) return;
  const subject = 'Your content has been approved';
  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #4F46E5; font-size: 24px; margin: 0;">Winsights Social</h1>
      </div>
      <div style="background-color: #ffffff; padding: 20px;">
        <h2 style="color: #111827; margin-top: 0;">Hello ${authorName},</h2>
        <p style="font-size: 16px; line-height: 1.5; color: #4B5563;">
          Good news! Your content has been reviewed and approved by our moderation team.
        </p>
        <div style="background-color: #F3F4F6; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #10B981;">
           <p style="margin: 0 0 10px; font-size: 15px;"><strong>Content Snippet:</strong><br/> <span style="color: #6B7280;">"${contentSummary || 'User content'}"</span></p>
           <p style="margin: 0; font-size: 15px;"><strong>Status:</strong> Approved & Visible</p>
        </div>
        <p style="font-size: 16px; line-height: 1.5; color: #4B5563;">
          It is now visible to the community. Thank you for your patience.
        </p>
        <p style="font-size: 14px; color: #6B7280; margin-top: 24px; border-top: 1px solid #eee; padding-top: 20px;">
          Best regards,<br/>The Winsights Moderation Team
        </p>
      </div>
    </div>
  `;
  return sendEmail({ to: authorEmail, subject, html });
}

/**
 * Notify User about Role Change
 */
async function sendRoleUpdateEmail({ user, newRole }) {
  const { email, name } = user;
  if (!email) return;

  const subject = 'Your account role has been updated';
  let roleDisplay = newRole;

  // Map internal roles to display names
  if (newRole === 'moderator-user') roleDisplay = 'Moderator';
  if (newRole === 'admin-user') roleDisplay = 'Administrator';
  if (newRole === 'patient-user') roleDisplay = 'Member';
  if (newRole === 'caregiver-user') roleDisplay = 'Caregiver';

  const html = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #4F46E5; font-size: 24px; margin: 0;">Winsights Social</h1>
      </div>
      <div style="background-color: #ffffff; padding: 20px;">
        <h2 style="color: #111827; margin-top: 0;">Hello ${name},</h2>
        <p style="font-size: 16px; line-height: 1.5; color: #4B5563;">
          Your account role on Winsights Social has been updated by an administrator.
        </p>
        <div style="background-color: #F3F4F6; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #4F46E5;">
           <p style="margin: 0; font-size: 16px;"><strong>New Role:</strong> ${roleDisplay}</p>
        </div>
        <p style="font-size: 16px; line-height: 1.5; color: #4B5563;">
          This change is effective immediately. If you have any questions, please contact support.
        </p>
        <p style="font-size: 14px; color: #6B7280; margin-top: 24px; border-top: 1px solid #eee; padding-top: 20px;">
          Best regards,<br/>The Winsights Team
        </p>
      </div>
    </div>
  `;

  return sendEmail({ to: email, subject, html });
}

module.exports = {
  sendEmail,
  sendTestEmail,
  verifyEmailTransport,
  getEmailConfigSummary,
  sendWelcomeEmail,
  sendModerationAlert,
  sendFriendRequestEmail,
  sendFriendRequestAcceptedEmail,
  sendContentRemovedEmailToAuthor,
  sendContentRemovedEmailToReporter,
  sendContentApprovedEmailToReporter,
  sendContentApprovedEmailToReporter,
  sendContentApprovedEmailToAuthor,
  sendRoleUpdateEmail
};
