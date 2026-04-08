/**
 * Runtime signals — not errors, just typed control-flow throws.
 * All abort/interrupt signal classes live here.
 */

/** System idle timeout aborted the react loop. */
export class IdleTimeoutSignal extends Error {
  constructor(public readonly timeoutMs: number) {
    super('Idle timeout');
    this.name = 'IdleTimeoutSignal';
  }
}

/** Step loop yielded to process a high-priority inbox message. */
export class PriorityInboxInterrupt {
  readonly name = 'PriorityInboxInterrupt';
}

/** User explicitly interrupted the turn (e.g. Esc key). */
export class UserInterrupt {
  readonly name = 'UserInterrupt';
}
