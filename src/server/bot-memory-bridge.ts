import type { BotMemoryStore, BotMemoryScope } from './bot-memory-store.ts';
import type { RunOwner } from './run-store.ts';

export type BotMemoryRunScope = BotMemoryScope;
/** The run capability supplies the Bot and owner; the model never chooses its own memory boundary. */
export class BotMemoryBridge {
  constructor(private readonly memories:Pick<BotMemoryStore,'list'|'remember'|'forget'>) {}
  async list(scope:BotMemoryRunScope,signal:AbortSignal) {
    if (signal.aborted) throw signal.reason || new Error('Run stopped');
    return this.memories.list(scope);
  }
  async remember(scope:BotMemoryRunScope,title:unknown,content:unknown,id?:unknown,signal?:AbortSignal) {
    if (signal?.aborted) throw signal.reason || new Error('Run stopped');
    return this.memories.remember(scope,title,content,id);
  }
  async forget(scope:BotMemoryRunScope,id:string,signal?:AbortSignal) {
    if (signal?.aborted) throw signal.reason || new Error('Run stopped');
    return this.memories.forget(scope,id);
  }
}
