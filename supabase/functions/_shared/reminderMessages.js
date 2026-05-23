export function reminderMessage(task) {
  return [
    `Waktunya mulai: ${task}.`,
    "",
    "Aturannya:",
    "1. Mulai sekarang.",
    "2. Jangan buka hal lain.",
    "3. Kalau malas, tetap mulai 5 menit.",
    "",
    "Klik Done kalau selesai, atau Skip kalau kamu benar-benar tidak mengerjakannya."
  ].join("\n");
}

export function doneMessage() {
  return "Selesai dicatat.\n\nBagus. Kamu menyelesaikan apa yang sudah kamu jadwalkan.";
}

export function skippedMessage() {
  return "Skip dicatat.\n\nKalau ini karena alasan valid, tidak masalah.\nKalau cuma malas, jangan dibiasakan.";
}
