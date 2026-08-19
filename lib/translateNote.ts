// Translates the Japanese business vocabulary that appears in statement line-item notes
// (building names, fee types, bracketed billing-context annotations) into English for
// display, while leaving tenant/company names untouched — this is a fixed-phrase
// dictionary substitution, not free-form translation, so anything not in the dictionary
// (a name, an English word already in the note) simply passes through unchanged.
const PHRASE_DICTIONARY: Record<string, string> = {
  管理委託料支払い: 'management fee payment',
  '原状回復工事費用（借主負担分）': 'restoration work cost (tenant-borne portion)',
  原状回復工事費用: 'restoration work cost',
  原状回復工事費: 'restoration work cost',
  '解約精算：貸主請求分': 'cancellation settlement: landlord-billed portion',
  解約精算: 'cancellation settlement',
  契約金請求: 'billed at contract',
  更新事務手数料: 'renewal administrative fee',
  再契約事務手数料: 're-contract administrative fee',
  更新時請求: 'billed at renewal',
  再契約時請求: 'billed at re-contract',
  更新料: 'renewal fee',
  再契約料: 're-contract fee',
  敷金: 'deposit',
  仲介手数料: 'brokerage commission',
  クリーニング費用: 'cleaning cost',
  賃料の2か月分: "2 months' rent",
  賃料の3か月分: "3 months' rent",
  井手ビル: 'Ide Building',
  レジデンスＤＯ５: 'Residence DO5',
  レジデンスDO5: 'Residence DO5',
  区画: ' space',
}

// Longest phrase first, so a longer match (e.g. "原状回復工事費用（借主負担分）") is substituted
// whole rather than being partially consumed by a shorter substring match first.
const SORTED_PHRASES = Object.keys(PHRASE_DICTIONARY).sort((a, b) => b.length - a.length)

export function translateNote(note: string): string {
  let result = note

  // "2026-08分Rent" / "2024-01分Parking" is extremely common across every rent/parking line
  // item — read as "Rent for 2026-08" — worth a dedicated pattern rather than a dictionary
  // entry per possible following word.
  result = result.replace(/(\d{4}-\d{2})分([A-Za-z]+)/g, '$2 for $1')

  for (const phrase of SORTED_PHRASES) {
    result = result.split(phrase).join(PHRASE_DICTIONARY[phrase])
  }

  // Full-width brackets wrap the billing-context annotations (e.g. "【cancellation
  // settlement】" after the phrase substitution above) — swap them for plain brackets.
  result = result.replace(/【/g, '[').replace(/】/g, ']')

  return result
}
