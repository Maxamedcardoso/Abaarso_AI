import vm from 'node:vm';

export interface CodeExecutionResult {
  success: boolean;
  output: string;
  executionTimeMs: number;
  language: string;
}

/**
 * CodeRunnerService — Safe, Sandboxed Execution and Programming Assistant for WhatsApp.
 * Enables live code evaluation, algorithmic inspection, and bug fixing right inside chat/groups.
 */
export class CodeRunnerService {
  /**
   * Safely executes JavaScript code within an isolated VM context.
   * Prevents infinite loops via strict timeout and shields host environment (no process/fs/require).
   */
  public executeJavaScript(code: string, timeoutMs: number = 2000): CodeExecutionResult {
    const startTime = Date.now();
    const logs: string[] = [];

    try {
      const sandbox: Record<string, any> = {
        console: {
          log: (...args: any[]) => {
            logs.push(args.map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' '));
          },
          info: (...args: any[]) => {
            logs.push(args.map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' '));
          },
          warn: (...args: any[]) => {
            logs.push('[WARN] ' + args.map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' '));
          },
          error: (...args: any[]) => {
            logs.push('[ERR] ' + args.map(a => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a))).join(' '));
          },
        },
        Math,
        Date,
        JSON,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Map,
        Set,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
      };

      const context = vm.createContext(sandbox);
      const result = vm.runInContext(code, context, { timeout: timeoutMs });
      const duration = Date.now() - startTime;

      let combinedOutput = logs.join('\n');
      if (result !== undefined) {
        let resStr = '';
        try {
          resStr = typeof result === 'object' && result !== null ? JSON.stringify(result, null, 2) : String(result);
        } catch {
          resStr = String(result);
        }
        combinedOutput = combinedOutput ? `${combinedOutput}\n=> ${resStr}` : `=> ${resStr}`;
      }

      if (!combinedOutput.trim()) {
        combinedOutput = '(Executed successfully with no return value)';
      }

      return {
        success: true,
        output: combinedOutput.slice(0, 3000), // Limit output size
        executionTimeMs: duration,
        language: 'javascript',
      };
    } catch (err: any) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        output: err?.message || 'Unknown execution error',
        executionTimeMs: duration,
        language: 'javascript',
      };
    }
  }

  /**
   * Formats execution result into an aesthetic WhatsApp Markdown decree.
   */
  public formatResult(result: CodeExecutionResult, codeSnippet: string): string {
    const statusIcon = result.success ? '✅' : '❌';
    const statusLabel = result.success ? 'GUUL (Success)' : 'CILAD (Execution Error)';

    let msg = `💻⚡ *[CARDOSO AI — LIVE CODE ENGINE]* ⚡💻\n\n`;
    msg += `🌐 *Luuqadda:* \`${result.language.toUpperCase()}\`\n`;
    msg += `⏱️ *Xawaaraha (Runtime):* \`${result.executionTimeMs}ms\`\n`;
    msg += `📊 *Xaaladda:* ${statusIcon} *${statusLabel}*\n\n`;

    const cleanCode = codeSnippet.length > 200 ? codeSnippet.slice(0, 200) + '...' : codeSnippet;
    msg += `📝 *Koodhka La Fuliyay:*\n\`\`\`javascript\n${cleanCode}\n\`\`\`\n\n`;

    msg += `🖥️ *NATIIJADA (OUTPUT):*\n\`\`\`\n${result.output}\n\`\`\`\n\n`;
    msg += `🤖 _Matoorka Cardoso AI Sandboxed Code Runner._`;

    return msg;
  }
}

export const codeRunnerService = new CodeRunnerService();

