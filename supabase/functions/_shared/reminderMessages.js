export function reminderMessage(task) {
  return [
    `Waktunya mulai: ${task}.`,
    "",
    "Aturannya sederhana:",
    "1. Mulai sekarang.",
    "2. Fokus ke satu hal ini saja.",
    "3. Kalau berat, kerjakan 5 menit pertama dulu.",
    "",
    "Klik Done kalau selesai.",
    "Klik Skip hanya kalau benar-benar tidak dikerjakan."
  ].join("\n");
}

export function doneMessage() {
  return "Selesai dicatat.\n\nBagus. Kamu menepati jadwal yang kamu buat sendiri.";
}

export function skippedMessage() {
  return "Skip dicatat.\n\nKalau alasannya valid, tidak masalah.\nKalau cuma malas atau menunda, jangan jadikan pola.";
}
