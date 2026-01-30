/**
 * 슬래시 명령어 핸들러
 * Clawdbot CLI를 직접 호출하여 명령어 처리
 */

import { exec } from "child_process";
import { promisify } from "util";
import { config } from "./config";
import { logger } from "./logger";
import { clearConversationHistory } from "./session-manager";

const execAsync = promisify(exec);

export interface CommandResult {
  handled: boolean;
  response?: string;
  sessionReset?: boolean;
  quickReplies?: { label: string; message: string }[];
}

// ANSI 이스케이프 코드 제거
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

// CLI 명령 실행
async function runCli(command: string, timeoutMs = 30000): Promise<string> {
  try {
    logger.debug(`Executing: ${command}`);
    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutMs,
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      shell: "powershell.exe",
    });

    const output = stripAnsi(stdout || stderr).trim();
    logger.debug(`CLI output: ${output.substring(0, 200)}...`);
    return output;
  } catch (error: any) {
    logger.error(`CLI error: ${error.message}`);
    if (error.stdout) {
      return stripAnsi(error.stdout).trim();
    }
    throw error;
  }
}

// 명령어 매핑
interface CommandMapping {
  cli?: string;
  handler?: (args: string, sessionKey: string) => Promise<string>;
  description: string;
}

// 퀵리플라이용 주요 명령어 (최대 10개)
const QUICK_COMMANDS = [
  { label: "📊 상태", message: "/status" },
  { label: "❓ 도움말", message: "/help" },
  { label: "🤖 모델", message: "/model" },
  { label: "🔄 초기화", message: "/clear" },
  { label: "🧠 추론", message: "/think" },
  { label: "💡 사용량", message: "/usage" },
  { label: "📝 명령어 전체", message: "/commands" },
];

const COMMANDS: Record<string, CommandMapping> = {
  // === "/" 단독 입력 → 명령어 선택 ===
  "/": {
    handler: async () => "🦞 명령어를 선택하세요!",
    description: "명령어 목록 선택",
  },

  // === 상태/정보 ===
  "/status": {
    cli: "clawdbot status",
    description: "시스템 상태 확인",
  },
  "/help": {
    handler: async () => getHelpText(),
    description: "도움말 표시",
  },
  "/commands": {
    handler: async () => getCommandList(),
    description: "명령어 목록",
  },
  "/whoami": {
    cli: "clawdbot whoami",
    description: "내 정보 확인",
  },
  "/id": {
    cli: "clawdbot whoami",
    description: "/whoami 별칭",
  },
  "/context": {
    cli: "clawdbot context",
    description: "컨텍스트 정보",
  },
  "/usage": {
    cli: "clawdbot usage",
    description: "사용량 확인",
  },

  // === 모델/설정 ===
  "/model": {
    handler: async (args) => {
      if (!args || args === "list") {
        return await runCli("clawdbot model list");
      }
      if (args === "status") {
        return await runCli("clawdbot model status");
      }
      // 모델 변경
      return await runCli(`clawdbot model set ${args}`);
    },
    description: "모델 선택/목록",
  },
  "/models": {
    handler: async (args) => COMMANDS["/model"].handler!(args, ""),
    description: "/model 별칭",
  },

  // === 세션 관리 ===
  "/reset": {
    handler: async (_args, sessionKey) => {
      clearConversationHistory(sessionKey);
      return "🔄 대화를 초기화했습니다. 새로운 대화를 시작하세요!";
    },
    description: "대화 초기화",
  },
  "/new": {
    handler: async (args, sessionKey) => COMMANDS["/reset"].handler!(args, sessionKey),
    description: "/reset 별칭",
  },
  "/clear": {
    handler: async (_args, sessionKey) => {
      clearConversationHistory(sessionKey);
      return "✅ 대화 기록이 초기화되었습니다.";
    },
    description: "대화 기록 초기화",
  },
  "/stop": {
    cli: "clawdbot stop",
    description: "현재 작업 중지",
  },

  // === 생각/추론 모드 ===
  "/think": {
    handler: async (args) => {
      const levels = ["off", "minimal", "low", "medium", "high", "xhigh"];
      if (!args) {
        return `🧠 생각 모드 설정\n\n사용법: /think <레벨>\n레벨: ${levels.join(", ")}\n\n예시: /think high`;
      }
      const level = args.toLowerCase();
      if (!levels.includes(level)) {
        return `❌ 잘못된 레벨입니다.\n사용 가능: ${levels.join(", ")}`;
      }
      // 디렉티브로 처리됨 - 다음 메시지에 적용
      return `🧠 생각 모드: ${level}\n\n다음 메시지부터 적용됩니다.`;
    },
    description: "생각 모드 (off/low/medium/high)",
  },
  "/thinking": {
    handler: async (args, sessionKey) => COMMANDS["/think"].handler!(args, sessionKey),
    description: "/think 별칭",
  },
  "/t": {
    handler: async (args, sessionKey) => COMMANDS["/think"].handler!(args, sessionKey),
    description: "/think 별칭",
  },

  // === Verbose/Reasoning ===
  "/verbose": {
    handler: async (args) => {
      const modes = ["on", "full", "off"];
      if (!args) {
        return `📝 상세 모드 설정\n\n사용법: /verbose <on|full|off>`;
      }
      if (!modes.includes(args.toLowerCase())) {
        return `❌ 잘못된 옵션입니다.\n사용 가능: ${modes.join(", ")}`;
      }
      return `📝 상세 모드: ${args}\n\n다음 메시지부터 적용됩니다.`;
    },
    description: "상세 출력 모드",
  },
  "/v": {
    handler: async (args, sessionKey) => COMMANDS["/verbose"].handler!(args, sessionKey),
    description: "/verbose 별칭",
  },
  "/reasoning": {
    handler: async (args) => {
      const modes = ["on", "off", "stream"];
      if (!args) {
        return `💭 추론 표시 설정\n\n사용법: /reasoning <on|off|stream>`;
      }
      if (!modes.includes(args.toLowerCase())) {
        return `❌ 잘못된 옵션입니다.\n사용 가능: ${modes.join(", ")}`;
      }
      return `💭 추론 모드: ${args}\n\n다음 메시지부터 적용됩니다.`;
    },
    description: "추론 표시 모드",
  },
  "/reason": {
    handler: async (args, sessionKey) => COMMANDS["/reasoning"].handler!(args, sessionKey),
    description: "/reasoning 별칭",
  },

  // === 권한/실행 ===
  "/elevated": {
    handler: async (args) => {
      const modes = ["on", "off", "ask", "full"];
      if (!args) {
        return `🔐 권한 상승 설정\n\n사용법: /elevated <on|off|ask|full>`;
      }
      if (!modes.includes(args.toLowerCase())) {
        return `❌ 잘못된 옵션입니다.\n사용 가능: ${modes.join(", ")}`;
      }
      return `🔐 권한 모드: ${args}\n\n다음 메시지부터 적용됩니다.`;
    },
    description: "권한 상승 모드",
  },
  "/elev": {
    handler: async (args, sessionKey) => COMMANDS["/elevated"].handler!(args, sessionKey),
    description: "/elevated 별칭",
  },

  // === TTS ===
  "/tts": {
    handler: async (args) => {
      const modes = ["off", "always", "inbound", "tagged", "status", "provider", "limit", "summary", "audio"];
      if (!args) {
        return `🔊 TTS 설정\n\n사용법: /tts <옵션>\n옵션: ${modes.join(", ")}`;
      }
      return `🔊 TTS: ${args}\n\n다음 메시지부터 적용됩니다.`;
    },
    description: "음성 합성 설정",
  },

  // === 스킬 ===
  "/skill": {
    handler: async (args) => {
      if (!args) {
        return await runCli("clawdbot skill list");
      }
      const [skillName, ...rest] = args.split(" ");
      const input = rest.join(" ");
      return await runCli(`clawdbot skill run ${skillName}${input ? ` "${input}"` : ""}`);
    },
    description: "스킬 실행",
  },

  // === 세션/서브에이전트 ===
  "/subagents": {
    cli: "clawdbot sessions list --kind subagent",
    description: "서브에이전트 목록",
  },

  // === 로컬 전용 ===
  "/localstatus": {
    handler: async () => {
      return `🦞 카카오톡 브릿지 상태

✅ 서버: 정상
📍 Gateway: ${config.clawdbot.gatewayUrl}
🤖 모델: ${config.clawdbot.model || "기본값"}

💡 Clawdbot 전체 상태는 /status 로 확인하세요.`;
    },
    description: "브릿지 상태 (로컬)",
  },
};

/**
 * 도움말 텍스트
 */
function getHelpText(): string {
  return `🦞 Clawdbot 카카오톡 도움말

📌 기본 명령어
/help - 도움말 표시
/status - 시스템 상태
/commands - 전체 명령어 목록

📌 세션 관리
/reset - 새 대화 시작
/clear - 대화 기록 초기화
/stop - 현재 작업 중지

📌 모델 설정
/model - 모델 목록
/model <이름> - 모델 변경
/model status - 모델 상태

📌 추론/사고 설정
/think <레벨> - 사고 깊이 (off/low/medium/high)
/verbose <on/off> - 상세 모드
/reasoning <on/off> - 추론 표시

📌 기타
/usage - 사용량 확인
/whoami - 내 정보
/skill <이름> - 스킬 실행

💡 예시
"안녕하세요" - 일반 대화
"/model opus" - 모델 변경
"/think high 복잡한 문제 분석해줘" - 깊은 사고로 분석`;
}

/**
 * 명령어 목록
 */
function getCommandList(): string {
  const categories: Record<string, string[]> = {
    "📊 상태/정보": ["/status", "/help", "/commands", "/whoami", "/context", "/usage"],
    "🤖 모델/설정": ["/model", "/think", "/verbose", "/reasoning", "/elevated"],
    "💬 세션 관리": ["/reset", "/clear", "/stop"],
    "🔧 기타": ["/tts", "/skill", "/subagents", "/localstatus"],
  };

  let result = "🦞 Clawdbot 명령어 목록\n\n";

  for (const [category, cmds] of Object.entries(categories)) {
    result += `${category}\n`;
    for (const cmd of cmds) {
      const info = COMMANDS[cmd];
      if (info) {
        result += `  ${cmd} - ${info.description}\n`;
      }
    }
    result += "\n";
  }

  return result.trim();
}

/**
 * 명령어인지 확인
 */
export function isCommand(message: string): boolean {
  return message.trim().startsWith("/");
}

/**
 * 명령어 파싱
 */
function parseCommand(message: string): { command: string; args: string } {
  const trimmed = message.trim();
  // /command: args 또는 /command args 형식 지원
  const match = trimmed.match(/^(\/\w+):?\s*(.*)/);
  if (match) {
    return { command: match[1].toLowerCase(), args: match[2].trim() };
  }
  return { command: trimmed.toLowerCase(), args: "" };
}

/**
 * 메인 명령어 핸들러
 */
export async function handleCommand(
  message: string,
  sessionKey: string
): Promise<CommandResult> {
  if (!isCommand(message)) {
    return { handled: false };
  }

  const { command, args } = parseCommand(message);
  logger.info(`Processing command: ${command} (args: "${args}")`);

  // /pair는 webhook-server에서 처리
  if (command === "/pair") {
    return { handled: false };
  }

  // 명령어 찾기
  const cmdInfo = COMMANDS[command];

  try {
    let response: string;

    if (cmdInfo) {
      // 등록된 명령어 처리
      if (cmdInfo.handler) {
        // 커스텀 핸들러
        response = await cmdInfo.handler(args, sessionKey);
      } else if (cmdInfo.cli) {
        // CLI 실행
        const fullCommand = args ? `${cmdInfo.cli} ${args}` : cmdInfo.cli;
        response = await runCli(fullCommand);
      } else {
        response = "이 명령어는 아직 구현되지 않았습니다.";
      }
    } else {
      // 등록되지 않은 명령어 → Clawdbot CLI로 직접 전달
      // /status → clawdbot status
      // /model list → clawdbot model list
      const cliCommand = command.slice(1); // "/" 제거
      const fullCommand = args ? `clawdbot ${cliCommand} ${args}` : `clawdbot ${cliCommand}`;
      
      logger.info(`Forwarding unknown command to CLI: ${fullCommand}`);
      
      try {
        response = await runCli(fullCommand);
      } catch (cliError: any) {
        // CLI에서 에러 발생 시 (명령어가 없는 경우 등)
        // 에러 메시지에 "unknown command" 또는 비슷한 게 있으면 안내
        if (cliError.message?.includes("not recognized") || 
            cliError.message?.includes("unknown") ||
            cliError.message?.includes("is not")) {
          logger.debug(`Unknown CLI command: ${cliCommand}`);
          return { handled: false }; // AI에게 전달
        }
        throw cliError;
      }
    }

    // 빈 응답 처리
    if (!response || response.trim() === "") {
      response = "✅ 명령어가 실행되었습니다.";
    }

    // "/" 단독 입력 시 퀵리플라이 추가
    if (command === "/") {
      return { handled: true, response, quickReplies: QUICK_COMMANDS };
    }

    return { handled: true, response };
  } catch (error: any) {
    logger.error(`Command execution error: ${error.message}`);
    return {
      handled: true,
      response: `❌ 명령어 실행 중 오류가 발생했습니다.\n\n${error.message}`,
    };
  }
}

/**
 * 디렉티브 추출 (메시지에서 /think, /model 등을 분리)
 * 메시지 앞에 붙은 디렉티브는 메시지와 함께 AI에게 전달
 */
export function extractDirectives(message: string): {
  directives: string[];
  cleanMessage: string;
} {
  const directivePatterns = [
    /^\/(think|thinking|t)\s+(off|minimal|low|medium|high|xhigh)\s+/i,
    /^\/(verbose|v)\s+(on|full|off)\s+/i,
    /^\/(reasoning|reason)\s+(on|off|stream)\s+/i,
    /^\/(elevated|elev)\s+(on|off|ask|full)\s+/i,
    /^\/model\s+(\S+)\s+/i,
    /^\/(exec)\s+[^\s]+\s+/i,
  ];

  const directives: string[] = [];
  let cleanMessage = message;

  for (const pattern of directivePatterns) {
    const match = cleanMessage.match(pattern);
    if (match) {
      directives.push(match[0].trim());
      cleanMessage = cleanMessage.replace(match[0], "").trim();
    }
  }

  return { directives, cleanMessage };
}
