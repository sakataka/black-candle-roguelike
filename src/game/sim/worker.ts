import { runSimulation, type SimulationRunInput } from "./simulation";
import { RESULT_PREFIX } from "./workerProtocol";

// batch の常駐ワーカー。標準入力からタスクを1行ずつ受け取り、結果を1行ずつ返す。
// 遠征ごとにプロセスを立て直すとJITが毎回冷えるため、同じプロセスで続けて回す。

declare const Bun: { stdin: { stream(): ReadableStream<Uint8Array> } };

const decoder = new TextDecoder();
let buffer = "";
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) await handle(line);
    newline = buffer.indexOf("\n");
  }
}

async function handle(line: string): Promise<void> {
  try {
    const result = await runSimulation(JSON.parse(line) as SimulationRunInput);
    console.log(`${RESULT_PREFIX}${JSON.stringify({ ok: true, result })}`);
  } catch (error) {
    console.log(`${RESULT_PREFIX}${JSON.stringify({ ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) })}`);
  }
}
