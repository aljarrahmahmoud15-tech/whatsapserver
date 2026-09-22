const assert = require("assert");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "admin.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(script, "يجب أن يحتوي admin.html على كتلة JavaScript");
assert.doesNotThrow(() => new Function(script), "JavaScript لوحة الإدارة يجب أن يكون صالحًا نحويًا");

assert.match(html, /id="recoveryPreviewButton"/, "زر المعاينة يجب أن يكون معرفًا لتعطيله أثناء الفحص");
assert.match(html, /window\.recoveryPreviewInFlight/, "المعاينة المكررة يجب أن تُمنع أثناء الفحص الحالي");
assert.match(html, /window\.recoveryConfirmInFlight/, "التأكيد المكرر يجب أن يُمنع أثناء الاعتماد الحالي");
assert.match(html, /function recoveryPayload\(match=null\)/, "حمولة الاسترداد يجب أن تقبل الصف المحدد");
assert.match(html, /payload\.sourceMessageId=String\(match\.sourceMessageId\|\|'\'\)\.trim\(\)/, "حمولة الصف يجب أن تحمل معرّف رسالة السعر");
assert.match(html, /payload\.acceptanceMessageId=String\(match\.acceptanceMessageId\|\|'\'\)\.trim\(\)/, "حمولة الصف يجب أن تحمل معرّف رد تم");
assert.match(html, /معرّف رسالة السعر/, "المعاينة يجب أن تعرض معرّف رسالة السعر");
assert.match(html, /معرّف رد «تم»/, "المعاينة يجب أن تعرض معرّف رد تم");
assert.match(html, /مطابق لكن معرّفات الرسائل ناقصة/, "الصف المطابق بلا معرفي الرسائل يجب ألا يظهر كقابل للاعتماد");
assert.match(html, /تحتاج معرّفي الرسائل/, "الصف المطابق بلا معرفي الرسائل يجب أن يمنع زر الاعتماد");
assert.match(html, /const canConfirm=Boolean\(m\.match&&sourceId&&acceptanceId\)/, "الاعتماد يجب أن يتطلب معرفي الرسائل معًا");
assert.match(html, /const payload=recoveryPayload\(match\)/, "زر الاعتماد يجب أن يبني الحمولة من الصف المحدد");
assert.doesNotMatch(html, /api\('\/api\/admin\/group\/confirm-one',[\s\S]{0,240}JSON\.stringify\(recoveryPayload\(\)\)/, "لا يجوز لزر الاعتماد إرسال الحقول العامة بدل الصف المحدد");
assert.match(html, /error\.data=data/, "واجهة الإدارة يجب أن تحتفظ بتفاصيل خطأ المطابقة");

console.log("recovery row payload and duplicate-action guardrails verified");
