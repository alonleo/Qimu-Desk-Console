package com.alon.admin.controller.monitor;

import oshi.SystemInfo;
import oshi.hardware.CentralProcessor;
import oshi.hardware.GlobalMemory;
import oshi.hardware.HardwareAbstractionLayer;
import oshi.software.os.FileSystem;
import oshi.software.os.OSFileStore;
import oshi.software.os.OperatingSystem;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;
import java.lang.management.MemoryUsage;
import java.lang.management.RuntimeMXBean;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 服务监控（OSHI 采集 CPU/内存/JVM/磁盘/系统信息）。
 *
 * <p>CPU 使用率通过前后两次 ticks 采样差值计算，避免 Thread.sleep 阻塞接口线程；
 * 磁盘信息用挂载点作为 dirName；本机 IP 优先返回非 127.0.0.1 的 IPv4 地址。
 *
 * <p>响应：{ ok, cpu, mem, jvm, sys, sysFiles }
 *
 * <p>前端调用：GET /api/monitor/server。建议 5s 轮询。
 */
@RestController
@RequestMapping("/api/monitor/server")
public class MonitorServerController {

    /** 上一帧 CPU ticks 采样，用于在两次请求间差值计算 CPU 使用率 */
    private static final AtomicReference<long[]> PREV_CPU_TICKS = new AtomicReference<>();

    @GetMapping
    public Map<String, Object> getInfo() {
        SystemInfo si = new SystemInfo();
        OperatingSystem os = si.getOperatingSystem();
        HardwareAbstractionLayer hal = si.getHardware();

        Map<String, Object> rsp = new LinkedHashMap<>();
        rsp.put("ok", true);
        rsp.put("cpu", buildCpu(hal.getProcessor()));
        rsp.put("mem", buildMem(hal.getMemory()));
        rsp.put("jvm", buildJvm());
        rsp.put("sys", buildSys(os));
        rsp.put("sysFiles", buildSysFiles(os.getFileSystem()));
        return rsp;
    }

    // ============================= CPU =============================

    private Map<String, Object> buildCpu(CentralProcessor processor) {
        Map<String, Object> cpu = new LinkedHashMap<>();
        long[] prev = PREV_CPU_TICKS.get();
        long[] curr = processor.getSystemCpuLoadTicks();

        long busy;
        long total;
        if (prev == null || prev.length != curr.length) {
            busy = 0L;
            total = 0L;
        } else {
            long busyDiff = 0L;
            long totalDiff = 0L;
            for (CentralProcessor.TickType type : CentralProcessor.TickType.values()) {
                int idx = type.getIndex();
                if (idx < 0 || idx >= curr.length || idx >= prev.length) continue;
                long diff = curr[idx] - prev[idx];
                if (diff < 0) diff = 0L;
                totalDiff += diff;
                if (type != CentralProcessor.TickType.IDLE
                        && type != CentralProcessor.TickType.IOWAIT
                        && type != CentralProcessor.TickType.IRQ) {
                    busyDiff += diff;
                }
            }
            busy = busyDiff;
            total = totalDiff;
        }
        PREV_CPU_TICKS.set(curr);

        double used = total <= 0 ? 0.0 : round(busy * 100.0 / total);
        double free = total <= 0 ? 100.0 : round(100.0 - used);

        cpu.put("cpuNum", processor.getLogicalProcessorCount());
        cpu.put("total", processor.getLogicalProcessorCount());
        cpu.put("used", used);
        cpu.put("sys", used);
        cpu.put("free", free);
        return cpu;
    }

    // ============================= MEM =============================

    private Map<String, Object> buildMem(GlobalMemory memory) {
        Map<String, Object> mem = new LinkedHashMap<>();
        long total = memory.getTotal();
        long avail = memory.getAvailable();
        long used = total - avail;
        mem.put("total", toGb(total));
        mem.put("used", toGb(used));
        mem.put("free", toGb(avail));
        mem.put("usage", total == 0 ? 0.0 : round(used * 10000.0 / total) / 100.0);
        return mem;
    }

    // ============================= JVM =============================

    private Map<String, Object> buildJvm() {
        RuntimeMXBean runtimeMx = ManagementFactory.getRuntimeMXBean();
        MemoryMXBean memoryMx = ManagementFactory.getMemoryMXBean();
        MemoryUsage heap = memoryMx.getHeapMemoryUsage();
        MemoryUsage nonHeap = memoryMx.getNonHeapMemoryUsage();
        long max = heap.getMax();
        long usedHeap = heap.getUsed();
        Properties props = System.getProperties();

        Map<String, Object> jvm = new LinkedHashMap<>();
        jvm.put("total", toMb(max));
        jvm.put("max", toMb(max));
        jvm.put("used", toMb(usedHeap));
        jvm.put("free", toMb(max - usedHeap));
        jvm.put("usage", max == 0 ? 0.0 : round(usedHeap * 10000.0 / max) / 100.0);
        jvm.put("name", runtimeMx.getVmName());
        jvm.put("version", props.getProperty("java.version"));
        jvm.put("vendor", props.getProperty("java.vendor"));
        jvm.put("startTime", runtimeMx.getStartTime());
        jvm.put("runTime", runtimeMx.getUptime());
        jvm.put("home", props.getProperty("java.home"));
        jvm.put("inputArgs", String.join(" ", runtimeMx.getInputArguments()));
        jvm.put("nonheapTotal", toMb(nonHeap.getInit()));
        jvm.put("nonheapUsed", toMb(nonHeap.getUsed()));
        jvm.put("nonheapMax", toMb(nonHeap.getMax()));
        return jvm;
    }

    // ============================= SYS =============================

    private Map<String, Object> buildSys(OperatingSystem os) {
        Properties props = System.getProperties();
        Map<String, Object> sys = new LinkedHashMap<>();
        sys.put("computerName", os.getNetworkParams().getHostName());
        sys.put("computerIp", getLocalIp());
        sys.put("userName", props.getProperty("user.name"));
        sys.put("osName", props.getProperty("os.name"));
        sys.put("osArch", props.getProperty("os.arch"));
        sys.put("osVersion", os.getVersionInfo().getVersion());
        sys.put("userDir", props.getProperty("user.dir"));
        sys.put("userHome", props.getProperty("user.home"));
        return sys;
    }

    // ============================= SYS FILES =============================

    private List<Map<String, Object>> buildSysFiles(FileSystem fs) {
        List<Map<String, Object>> sysFiles = new ArrayList<>();
        for (OSFileStore store : fs.getFileStores()) {
            long free = store.getUsableSpace();
            long total = store.getTotalSpace();
            long used = total - free;
            Map<String, Object> sf = new LinkedHashMap<>();
            String mount = store.getMount();
            sf.put("dirName", mount == null || mount.isEmpty() ? store.getName() : mount);
            sf.put("sysTypeName", store.getType());
            sf.put("typeName", store.getName());
            sf.put("total", toGb(total));
            sf.put("free", toGb(free));
            sf.put("used", toGb(used));
            sf.put("usage", total == 0 ? 0.0 : round(used * 10000.0 / total) / 100.0);
            sysFiles.add(sf);
        }
        return sysFiles;
    }

    // ============================= Helpers =============================

    private static double toGb(long bytes) {
        return round(bytes / 1024.0 / 1024.0 / 1024.0);
    }

    private static long toMb(long bytes) {
        return bytes <= 0 ? 0L : bytes / 1024L / 1024L;
    }

    private static double round(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    /** 获取本机 IPv4 地址：优先返回非 loopback、非虚拟、非 127 的地址 */
    private static String getLocalIp() {
        try {
            Enumeration<NetworkInterface> nis = NetworkInterface.getNetworkInterfaces();
            while (nis != null && nis.hasMoreElements()) {
                NetworkInterface ni = nis.nextElement();
                if (ni.isLoopback() || ni.isVirtual() || !ni.isUp()) continue;
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs != null && addrs.hasMoreElements()) {
                    InetAddress addr = addrs.nextElement();
                    if (addr.isLoopbackAddress() || addr.isAnyLocalAddress()) continue;
                    String host = addr.getHostAddress();
                    if (host != null && host.indexOf(':') < 0) return host;
                }
            }
        } catch (Exception ignored) {
        }
        return "127.0.0.1";
    }
}
