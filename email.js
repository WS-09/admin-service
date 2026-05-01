// email.js
async function sendUserCredentials(email, resetLink) {
  try {
    const response = await fetch(process.env.GAS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        secret: process.env.GAS_SECRET,
        to: email,
        subject: "تفعيل حسابك",
        html: `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,sans-serif;direction:rtl;text-align:right;">

  <div style="max-width:600px;margin:30px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);direction:rtl;text-align:right;">

    <div style="background:#4f46e5;color:white;padding:20px;text-align:center;font-size:20px;font-weight:bold;">
      🎉 تم إنشاء حسابك بنجاح
    </div>

    <div style="padding:25px;color:#333;line-height:1.8;font-size:15px;direction:rtl;text-align:right;">

      <p>مرحباً 👋</p>

      <p>
        تم إنشاء حسابك بنجاح من قبل الإدارة. يمكنك الآن تفعيل حسابك
        من خلال إنشاء كلمة المرور الخاصة بك.
      </p>

      <p>
        اضغط على الزر أدناه لتعيين كلمة المرور:
      </p>

      <a href="${resetLink}" 
         style="display:block;width:fit-content;margin:25px auto;background:#4f46e5;color:#fff !important;text-decoration:none;padding:12px 25px;border-radius:8px;font-size:16px;font-weight:bold;">
        تعيين كلمة المرور
      </a>

      <p>
        ⚠️ هذا الرابط مخصص لك فقط، وسيتم انتهاء صلاحيته لأسباب أمنية.
      </p>

      <p>
        إذا لم تطلب هذا الحساب، يمكنك تجاهل هذه الرسالة.
      </p>

      <p>بالتوفيق 🌟</p>

    </div>

    <div style="text-align:center;font-size:12px;color:#888;padding:15px;border-top:1px solid #eee;">
      © ${new Date().getFullYear()} جميع الحقوق محفوظة
    </div>

  </div>

</body>
</html>
`,
      }),
    });

    const result = await response.json();

    if (!result.success) {
      console.error("❌ GAS Email error:", result.error);
    } else {
      console.log("📧 Email sent via GAS:", email);
    }

  } catch (err) {
    console.error("❌ Email failed:", err.message);
  }
}

module.exports = { sendUserCredentials };