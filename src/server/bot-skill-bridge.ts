import type { BotSkillInput, BotSkillScope, BotSkillStore } from './bot-skill-store.ts';

export class BotSkillBridge {
  constructor(private readonly skills: Pick<BotSkillStore, 'listForRun' | 'createForRun' | 'updateForRun' | 'removeForRun'>) {}
  async list(scope: BotSkillScope, signal: AbortSignal) {
    if (signal.aborted) throw signal.reason || new Error('Run stopped');
    return this.skills.listForRun(scope);
  }
  async create(scope: BotSkillScope, input: BotSkillInput, allowed: boolean, signal: AbortSignal) {
    if (signal.aborted) throw signal.reason || new Error('Run stopped');
    return this.skills.createForRun(scope, input, allowed);
  }
  async update(scope: BotSkillScope, id: string, input: BotSkillInput, allowed: boolean, signal: AbortSignal) {
    if (signal.aborted) throw signal.reason || new Error('Run stopped');
    return this.skills.updateForRun(scope, id, input, allowed);
  }
  async remove(scope: BotSkillScope, id: string, allowed: boolean, signal: AbortSignal) {
    if (signal.aborted) throw signal.reason || new Error('Run stopped');
    return this.skills.removeForRun(scope, id, allowed);
  }
}
