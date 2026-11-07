import { IStudentMemory } from '../memory/memory.interface.js';
import { AIOrchestrator } from '../ai/ai-orchestrator.js';
import { MessageRouter } from '../pipeline/message-router.js';

export interface AdminSystemStats {
  systemHealth: 'healthy' | 'degraded' | 'offline';
  database: {
    totalStudents: number;
    totalMessages: number;
    oldestMessageDate: string | null;
  };
  ai: {
    geminiStatus: any;
    fallbackStatus: any;
    quotaStats: any;
  };
  router: {
    isBotActiveGlobally: boolean;
    inactiveGroupsCount: number;
  };
  uptimeSeconds: number;
}

export class AdminService {
  private memory: IStudentMemory;
  private ai: AIOrchestrator;
  private router: MessageRouter;
  private startTime: number = Date.now();

  constructor(memory: IStudentMemory, ai: AIOrchestrator, router: MessageRouter) {
    this.memory = memory;
    this.ai = ai;
    this.router = router;
  }

  public async getSystemStats(): Promise<AdminSystemStats> {
    const dbStats = await this.memory.getStats();
    const aiStatus = this.ai.getStatus();
    const routerStatus = this.router.getStatus();

    const isHealthy = aiStatus.gemini.healthy && !aiStatus.quota.isDailyQuotaExhausted;

    return {
      systemHealth: isHealthy ? 'healthy' : 'degraded',
      database: dbStats,
      ai: {
        geminiStatus: aiStatus.gemini,
        fallbackStatus: aiStatus.llamaFallback,
        quotaStats: aiStatus.quota,
      },
      router: routerStatus,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  public async purgeOldData(days: number): Promise<number> {
    return await this.memory.purgeStaleData(days);
  }

  public async deleteStudent(studentId: string): Promise<boolean> {
    return await this.memory.deleteStudentHistory(studentId);
  }
}

