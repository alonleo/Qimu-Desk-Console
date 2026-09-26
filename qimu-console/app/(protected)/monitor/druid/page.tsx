export const dynamic = "force-dynamic";

export default async function MonitorDruidPage() {
  const backend = process.env.BACKEND_URL || "http://localhost:8080";
  const src = `${backend}/druid/index.html`;
  return (
    <iframe
      src={src}
      title="Druid 数据监控"
      style={{ height: "calc(100vh - 190px)", width: "100%", border: "1px solid #f0f0f0", borderRadius: 8, background: "#fff" }}
    />
  );
}