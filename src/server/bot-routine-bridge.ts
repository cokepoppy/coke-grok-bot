import type { RoutineEditInput, RoutineRunScope, RoutineStore } from './routine-store.ts';

/** The model capability supplies the Bot, tenant, user, run, and live lease scope. */
export type BotRoutineScope = RoutineRunScope;

export class BotRoutineBridge {
  constructor(private readonly routines: Pick<RoutineStore, 'listForRun' | 'createForRun' | 'updateForRun'>) {}

  async list(scope: BotRoutineScope, signal: AbortSignal) {
    if (signal.aborted) throw signal.reason || new Error('Run stopped');
    return this.routines.listForRun(scope);
  }

  async create(scope: BotRoutineScope, input: RoutineEditInput, signal: AbortSignal) {
    if (signal.aborted) throw signal.reason || new Error('Run stopped');
    return this.routines.createForRun(scope, input);
  }

  async update(scope: BotRoutineScope, routineId: string, input: RoutineEditInput, signal: AbortSignal) {
    if (signal.aborted) throw signal.reason || new Error('Run stopped');
    return this.routines.updateForRun(scope, routineId, input);
  }
}
