/**
 * Ambient upgrade discovery: the one fact owned here is *which new Suite versions the user has already
 * been told about in this session*.
 *
 * The page already carries the durable record (the upgrade card). A client that also polls in the
 * background must not become a second, nagging copy of it: a version is announced once, and only a
 * version the user has not seen before earns a new announcement. Skipping an announcement is not a
 * decision about the upgrade -- nothing is installed here, and the card stays the place where the
 * upgrade is read and run.
 */
export interface AmbientCandidate {
 /** The version the Host would install; `latest` is absent when no candidate is installable. */
 version: string;
 /** The version currently loaded, for the sentence. */
 currentVersion?: string | null;
}

export class UpgradeAnnouncer {
 private readonly announced = new Set<string>();

 /**
   * The version worth interrupting the user about, or `null` for silence.
   *
   * Silence covers three different facts on purpose: no candidate, a version already announced in this
   * session, and a malformed candidate. None of them is a reason to show anything, and none of them may
   * be reported as an announcement that happened.
   */
  decide(candidate: AmbientCandidate | null | undefined): string | null {
   const version = typeof candidate?.version === 'string' ? candidate.version.trim() : '';
   if (version === '') return null;
   if (this.announced.has(version)) return null;
   this.announced.add(version);
   return version;
  }

 /** Whether this session has already interrupted the user about `version`. */
  has(version: string): boolean {
   return this.announced.has(version);
  }

 /** Test and debug aid: how many distinct versions have been announced. */
  get count(): number {
   return this.announced.size;
  }
}
