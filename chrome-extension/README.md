# PLK Platform Chat Badge

Chrome extension สำหรับแสดงจำนวนข้อความ `/chat/admin` ที่ยังไม่ได้อ่านบน toolbar badge โดยรับ event ผ่าน Web Push service เดิมของระบบ

## Install

1. เปิด `chrome://extensions`
2. เปิด `Developer mode`
3. กด `Load unpacked`
4. เลือกโฟลเดอร์ `chrome-extension`

ตอนติดตั้ง extension จะ subscribe กับ `https://platform.plkhealth.go.th/api/chat/push-subscriptions`
ด้วย VAPID key ของระบบ จากนั้นเมื่อ server ส่ง push เข้า extension จะ fetch
`/api/chat/admin/unread` เพื่อดึงยอดรวม `admin_unread` สำหรับ badge โดยเฉพาะ

## Usage

- badge สีแดง = มีข้อความยังไม่ได้อ่าน
- badge สีเขียวใน popup = ไม่มีข้อความค้างอ่าน
- badge `!` = subscribe/fetch API ไม่สำเร็จ
- กด extension popup เพื่อ register push ใหม่พร้อม sync badge หรือ `Open Admin`
- แก้ `Server URL` ได้ใน popup เช่น `http://localhost:3000` ตอนทดสอบ local
