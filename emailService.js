import nodemailer from 'nodemailer';

// Create email transporter
// NOTE: For production, use environment variables for credentials
const transporter = nodemailer.createTransport({
  service: 'gmail', // You can use other services like 'outlook', 'yahoo', etc.
  auth: {
    user: 'noahlopez7102005@gmail.com', // Replace with your email
    pass: 'itjn lqak gjqk tbpv'      // Replace with your app password (not regular password)
  }
});

// Function to send appointment confirmation email
export const sendAppointmentConfirmation = async (appointmentData) => {
  const { name, email, phone, date, service } = appointmentData;

  // Format date for better readability
  const formattedDate = new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Email options
  const mailOptions = {
    from: '"Stella Maris Clinic" <noahlopez7102005@gmail.com>', // Replace with your email
    to: email,
    subject: 'Appointment Confirmation - Stella Maris Clinic',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f5ebe0;
              border-radius: 10px;
            }
            .header {
              background-color: #e8d5c4;
              padding: 20px;
              text-align: center;
              border-radius: 8px 8px 0 0;
            }
            .header h1 {
              margin: 0;
              color: #5a5a5a;
            }
            .content {
              background-color: white;
              padding: 30px;
              border-radius: 0 0 8px 8px;
            }
            .appointment-details {
              background-color: #f5ebe0;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .detail-row {
              margin: 10px 0;
              padding: 8px 0;
              border-bottom: 1px solid #e8d5c4;
            }
            .detail-row:last-child {
              border-bottom: none;
            }
            .label {
              font-weight: bold;
              color: #c9a882;
            }
            .footer {
              text-align: center;
              margin-top: 20px;
              padding: 20px;
              color: #666;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Stella Maris Clinic</h1>
              <p>Appointment Confirmation</p>
            </div>
            <div class="content">
              <p>Dear ${name},</p>
              
              <p>Thank you for booking an appointment with Stella Maris Clinic. We have received your appointment request and will contact you shortly to confirm the exact time.</p>
              
              <div class="appointment-details">
                <h3 style="color: #c9a882; margin-top: 0;">Appointment Details</h3>
                <div class="detail-row">
                  <span class="label">Patient Name:</span> ${name}
                </div>
                <div class="detail-row">
                  <span class="label">Email:</span> ${email}
                </div>
                <div class="detail-row">
                  <span class="label">Phone:</span> ${phone}
                </div>
                <div class="detail-row">
                  <span class="label">Preferred Date:</span> ${formattedDate}
                </div>
                <div class="detail-row">
                  <span class="label">Service:</span> ${service}
                </div>
                <div class="detail-row">
                  <span class="label">Status:</span> Pending Confirmation
                </div>
              </div>
              
              <p><strong>What's Next?</strong></p>
              <ul>
                <li>Our staff will contact you within 24 hours to confirm your appointment time</li>
                <li>Please have your insurance information ready (if applicable)</li>
                <li>Arrive 15 minutes early to complete any necessary paperwork</li>
              </ul>
              
              <p>If you need to cancel or reschedule your appointment, please contact us at:</p>
              <p>
                <strong>Phone:</strong> (123) 456-7890<br>
                <strong>Email:</strong> info@stellamarisclinic.com
              </p>
              
              <p>We look forward to seeing you!</p>
              
              <p>Warm regards,<br>
              <strong>The Stella Maris Clinic Team</strong></p>
            </div>
            <div class="footer">
              <p>Stella Maris Clinic<br>
              123 Healthcare Avenue, Medical District<br>
              Phone: (123) 456-7890<br>
              Email: info@stellamarisclinic.com</p>
              <p style="font-size: 12px; color: #999; margin-top: 10px;">
                This is an automated confirmation email. Please do not reply directly to this message.
              </p>
            </div>
          </div>
        </body>
      </html>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
};
