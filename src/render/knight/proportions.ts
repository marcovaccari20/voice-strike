// Koerpermasse des Ritters in Metern - abgenommen von Marcos Bildvorlage
// (gedrungene Spielfigur: der Helm ist ein Drittel der Koerperhoehe, die
// Beine sind kurz, Schultern und Arme kraeftig).
//
// Die Figur steht in ihrem eigenen Koordinatensystem: +Z zeigt zum Gegner,
// +X ist IHRE linke Seite, +Y ist oben, der Boden liegt bei y = 0.
// Knochen von Armen und Beinen zeigen in der Ruhelage nach unten (-Y); ihr
// +Z zeigt nach vorn, ihr +X zur linken Seite der Figur.

export const BODY = {
  // Bein
  /** Hoehe des Knoechelgelenks ueber der Sohle. */
  ankleHeight: 0.085,
  /** Knoechel bis Knie. */
  shin: 0.215,
  /** Knie bis Hueftgelenk. */
  thigh: 0.26,
  /** Hueftgelenk seitlich der Mitte. */
  hipWidth: 0.125,
  /** Sohle: vom Knoechel nach vorn bis zur Zehenspitze / nach hinten bis zur Ferse. */
  footFront: 0.19,
  footBack: 0.08,
  footWidth: 0.16,

  // Rumpf (jeweils Abstand zum Elternknochen entlang +Y)
  /** Becken -> Taille (Guertel). */
  waist: 0.11,
  /** Taille -> Brust. */
  chest: 0.15,
  /** Brust -> Halsansatz. */
  neck: 0.27,
  /** Hals -> Helmunterkante (Ursprung des Kopfknochens). */
  head: 0.06,
  /** Hoehe des Helms ueber dem Ursprung des Kopfknochens. */
  helmetHeight: 0.55,

  // Arm
  /** Schultergelenk relativ zum Brustknochen. */
  shoulderX: 0.32,
  shoulderY: 0.21,
  /** Schulter bis Ellbogen. */
  upperArm: 0.25,
  /** Ellbogen bis Griffmitte der Hand. */
  forearm: 0.23,

  // Waffe und Schild
  /** Klinge: Beginn und Ende entlang der Schwertachse, ab Griffmitte. */
  bladeStart: 0.09,
  bladeEnd: 0.71,
  bladeWidth: 0.11,
  /** Wie weit die zweite Hand unter der ersten am Griff sitzt. */
  secondGrip: 0.1,
  shieldRadius: 0.31,
  /** Schildflaeche vor der Faust. */
  shieldOffset: 0.07,

  // Federnde Teile
  /** Wappenrock unter dem Guertel: zwei Glieder. */
  tabardSegment: 0.16,
  /** Helmbusch: drei Glieder. */
  plumeSegment: 0.085,
} as const;

/** Hoehe des Hueftgelenks bei durchgestreckten Beinen. */
export const HIP_HEIGHT = BODY.ankleHeight + BODY.shin + BODY.thigh;
/** Brustknochen in der aufrechten Ruhelage - Bezugspunkt der Hand-Zielpunkte. */
export const CHEST_REST_Y = HIP_HEIGHT + BODY.waist + BODY.chest;
/** Schultergelenk in der aufrechten Ruhelage. */
export const SHOULDER_REST_Y = CHEST_REST_Y + BODY.shoulderY;
/** Unterkante des Helms in der aufrechten Ruhelage. */
export const HEAD_REST_Y = CHEST_REST_Y + BODY.neck + BODY.head;
/** Scheitel des Helms in der aufrechten Ruhelage (ohne Busch). */
export const TOP_REST_Y = HEAD_REST_Y + BODY.helmetHeight;
/** Laengste Reichweite des Arms von der Schulter bis zur Griffmitte. */
export const ARM_REACH = BODY.upperArm + BODY.forearm;
/** Laengste Reichweite des Beins vom Hueftgelenk bis zum Knoechel. */
export const LEG_REACH = BODY.thigh + BODY.shin;

/**
 * Grobe Huellen der dicken Koerperteile, jeweils als Ellipsoid im
 * Koordinatensystem des genannten Knochens. Das Netz (mesh.ts) haelt sich an
 * diese Masse, die Bewegungspruefung (tests/animation.test.ts) nutzt sie, um
 * Durchdringungen zu finden: Hand im Helm, Klinge im Bauch.
 */
export const VOLUMES = {
  helmet: { bone: 'Head', center: [0, 0.275, 0.01], radius: [0.225, 0.285, 0.235] },
  chest: { bone: 'Chest', center: [0, 0.11, 0.0], radius: [0.27, 0.2, 0.19] },
  belly: { bone: 'Spine', center: [0, 0.02, 0.0], radius: [0.25, 0.16, 0.19] },
  hips: { bone: 'Hips', center: [0, 0.0, 0.0], radius: [0.24, 0.15, 0.18] },
  pauldronL: { bone: 'UpperArm.L', center: [0.03, 0.02, 0], radius: [0.15, 0.13, 0.15] },
  pauldronR: { bone: 'UpperArm.R', center: [-0.03, 0.02, 0], radius: [0.15, 0.13, 0.15] },
} as const;

export type VolumeId = keyof typeof VOLUMES;
