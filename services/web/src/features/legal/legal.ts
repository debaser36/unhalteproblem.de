/**
 * Facts the Impressum and the privacy policy state. `undefined` marks one
 * that is still missing: the pages show a visible placeholder for it, so a
 * gap is never hidden.
 */
export const legal = {
  name: "Nico Burkholder",
  email: "contact@unhalteproblem.de",
  /**
   * TODO: the postal address that accepts legal mail (no PO box), one line
   * per entry, e.g. `["Musterstraße 1", "12345 Musterstadt", "Deutschland"]`.
   */
  address: undefined as ReadonlyArray<string> | undefined,
  /** TODO: the USt-IdNr (§ 27a UStG) once there is one. Not shown until then. */
  vatId: undefined as string | undefined,
  /**
   * TODO: the data protection authority of the Bundesland of `address`,
   * e.g. "Der Landesbeauftragte für den Datenschutz und die
   * Informationsfreiheit Baden-Württemberg, Lautenschlagerstraße 20,
   * 70173 Stuttgart".
   */
  supervisoryAuthority: undefined as string | undefined,
  /**
   * TODO: the provider that sends the contact form mails and hosts the
   * mailbox of `email`, with its address, e.g. "WEB.DE (1&1 Mail & Media
   * GmbH, Brauerstraße 48, 76135 Karlsruhe)".
   */
  mailProvider: undefined as string | undefined,
  /** Must match the nginx and journald settings on the server. */
  logRetentionDays: 14,
  /** `backup.keepDays` of the NixOS module. */
  backupRetentionDays: 14,
  /** The date the privacy policy was last changed. */
  updated: { de: "Oktober 2026", en: "October 2026" },
} as const;

export type Language = "de" | "en";

/** German is the default and the binding version; `?lang=en` is a translation. */
export const parseLanguage = (value: string | null): Language =>
  value === "en" ? "en" : "de";
