import { serverApi } from "@/utils/serverApi";
import AiGateways, { type AiGatewayDto } from "@/components/ai/AiGateways";

export const dynamic = "force-dynamic";

/** AI 网关管理：多网关增删改查，默认网关供前台 AI 工作平台调用 */
export default async function AiPage() {
  const { gateways } = await serverApi<{ gateways: AiGatewayDto[] }>("/ai/gateways");
  return <AiGateways gateways={gateways} />;
}
