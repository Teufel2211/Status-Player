import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.commons.ClassRemapper;
import org.objectweb.asm.commons.Remapper;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.attribute.FileTime;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.CRC32;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * A4 helper: applies a ProGuard class mapping to an already compiled JAR.
 *
 * <p>ProGuard is only used to compute the mapping. Its own output is discarded because
 * ProGuard 7.10.0 writes broken StackMapTable frames for class file version 69 (Java 25),
 * which makes the JAR fail with {@code VerifyError: Bad type on operand stack}.
 *
 * <p>This tool therefore keeps the original bytecode and only rewrites constant pool
 * class references, which leaves the original, valid stack map frames untouched.
 * Debug information (SourceFile, LineNumberTable, LocalVariableTable) is dropped.
 *
 * <p>The output JAR is written by hand instead of via {@link java.util.zip.ZipOutputStream}.
 * {@code ZipOutputStream} streams entries and therefore always sets the data descriptor flag
 * (0x0008), because sizes are only known after the entry has been written. Forge's
 * SecureJar reader parses the archive with {@code JarInputStream}, which cannot recover from
 * data descriptors here and fails with "invalid entry size". Writing explicit local headers
 * with the real CRC and sizes (flag 0x0000) keeps the archive readable by every loader.
 *
 * <p>Usage: {@code java -cp asm.jar;asm-commons.jar ObfuscateRemap.java <in.jar> <mapping.txt> <out.jar>}
 */
public final class ObfuscateRemap {

    private static final String OWN_PREFIX = "com/teufel/statusmod/";
    private static final String SERVICES_PREFIX = "META-INF/services/";
    private static final String MANIFEST_ENTRY = "META-INF/MANIFEST.MF";

    private ObfuscateRemap() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 3) {
            System.err.println("usage: ObfuscateRemap <in.jar> <mapping.txt> <out.jar>");
            System.exit(2);
        }
        Path inJar = Paths.get(args[0]);
        Path mappingFile = Paths.get(args[1]);
        Path outJar = Paths.get(args[2]);

        Map<String, String> classMap = parseClassMapping(mappingFile);
        Remapper remapper = new ClassOnlyRemapper(classMap);

        List<PendingEntry> entries = new ArrayList<>();
        int remapped = 0;
        int copied = 0;

        try (ZipFile zip = new ZipFile(inJar.toFile())) {
            PendingEntry manifest = null;
            Enumeration<? extends ZipEntry> source = zip.entries();
            while (source.hasMoreElements()) {
                ZipEntry entry = source.nextElement();
                if (entry.isDirectory()) {
                    continue;
                }
                String name = entry.getName();
                byte[] data = readAll(zip.getInputStream(entry));
                long time = dosTime(entry.getLastModifiedTime());

                PendingEntry pending;
                if (name.endsWith(".class") && name.startsWith(OWN_PREFIX)) {
                    pending = new PendingEntry(mapEntryName(classMap, name), rewriteClass(data, remapper), time);
                    remapped++;
                } else if (name.startsWith(SERVICES_PREFIX)) {
                    pending = new PendingEntry(mapEntryName(classMap, name), rewriteServiceFile(data, classMap), time);
                    copied++;
                } else {
                    pending = new PendingEntry(name, data, time);
                    copied++;
                }

                if (pending.name.equals(MANIFEST_ENTRY)) {
                    manifest = pending;
                } else {
                    entries.add(pending);
                }
            }
            if (manifest != null) {
                // JarInputStream only exposes the manifest when it is the first entry.
                entries.add(0, manifest);
            }
        }

        Files.deleteIfExists(outJar);
        try (ZipWriter writer = new ZipWriter(Files.newOutputStream(outJar))) {
            for (PendingEntry entry : entries) {
                writer.add(entry.name, entry.data, entry.time);
            }
            writer.finish();
            System.out.println("remapped=" + remapped + " copied=" + copied + " entries=" + writer.count());
        }

        // Sanity check: the archive must be readable as a plain ZIP afterwards.
        try (ZipFile check = new ZipFile(outJar.toFile())) {
            if (check.size() != entries.size()) {
                throw new IOException("entry count mismatch: wrote " + entries.size()
                        + " but read back " + check.size());
            }
        }
    }

    private static String mapEntryName(Map<String, String> classMap, String name) {
        if (name.endsWith(".class") && name.startsWith(OWN_PREFIX)) {
            String internal = name.substring(0, name.length() - ".class".length());
            String mapped = classMap.get(internal);
            return (mapped == null ? internal : mapped) + ".class";
        }
        if (name.startsWith(SERVICES_PREFIX)) {
            String service = name.substring(SERVICES_PREFIX.length());
            String mapped = classMap.get(service.replace('.', '/'));
            return SERVICES_PREFIX + (mapped == null ? service : mapped.replace('/', '.'));
        }
        return name;
    }

    private static byte[] rewriteClass(byte[] data, Remapper remapper) {
        ClassReader reader = new ClassReader(data);
        // maxStack/maxLocals and the stack map frames are taken over verbatim from the
        // original class; only SKIP_DEBUG removes SourceFile/LineNumberTable/LocalVariableTable.
        ClassWriter writer = new ClassWriter(0);
        ClassVisitor visitor = new ClassRemapper(writer, remapper);
        reader.accept(visitor, ClassReader.SKIP_DEBUG);
        return writer.toByteArray();
    }

    private static byte[] rewriteServiceFile(byte[] data, Map<String, String> classMap) {
        List<String> lines = new ArrayList<>();
        for (String line : new String(data, StandardCharsets.UTF_8).split("\\R")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty() || trimmed.startsWith("#") || trimmed.startsWith("//")) {
                lines.add(line);
                continue;
            }
            String mapped = classMap.get(trimmed.replace('.', '/'));
            lines.add(mapped == null ? trimmed : mapped.replace('/', '.'));
        }
        return (String.join("\n", lines) + "\n").getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream(16384);
        byte[] chunk = new byte[8192];
        int read;
        while ((read = in.read(chunk)) > 0) {
            buffer.write(chunk, 0, read);
        }
        return buffer.toByteArray();
    }

    private static byte[] deflate(byte[] data) {
        Deflater deflater = new Deflater(Deflater.DEFAULT_COMPRESSION, true);
        try {
            deflater.setInput(data);
            deflater.finish();
            ByteArrayOutputStream buffer = new ByteArrayOutputStream(Math.max(64, data.length / 2));
            byte[] chunk = new byte[8192];
            while (!deflater.finished()) {
                int written = deflater.deflate(chunk);
                if (written <= 0) {
                    break;
                }
                buffer.write(chunk, 0, written);
            }
            return buffer.toByteArray();
        } finally {
            deflater.end();
        }
    }

    /** MS-DOS packed timestamp (date in the high word, time in the low word). */
    private static long dosTime(FileTime time) {
        if (time == null) {
            return 0L;
        }
        LocalDateTime stamp = LocalDateTime.ofInstant(time.toInstant(), ZoneId.systemDefault());
        int year = stamp.getYear();
        if (year < 1980) {
            year = 1980;
        } else if (year > 2107) {
            year = 2107;
        }
        int date = ((year - 1980) << 9) | (stamp.getMonthValue() << 5) | stamp.getDayOfMonth();
        int clock = (stamp.getHour() << 11) | (stamp.getMinute() << 5) | (stamp.getSecond() / 2);
        return ((long) date << 16) | (clock & 0xFFFFL);
    }

    private static final class PendingEntry {
        private final String name;
        private final byte[] data;
        private final long time;

        private PendingEntry(String name, byte[] data, long time) {
            this.name = name;
            this.data = data;
            this.time = time;
        }
    }

    /**
     * Minimal ZIP writer: local headers carry the real CRC-32 and sizes, so no data
     * descriptor (flag 0x0008) is needed. JARs stay far below the 4 GiB / 65535 entry
     * limits, so ZIP64 is not implemented.
     */
    private static final class ZipWriter implements Closeable {

        private static final int LOCAL_SIGNATURE = 0x04034b50;
        private static final int CENTRAL_SIGNATURE = 0x02014b50;
        private static final int END_SIGNATURE = 0x06054b50;
        private static final int VERSION = 20;
        private static final int FLAG_UTF8 = 0x0800;
        private static final int METHOD_STORED = 0;
        private static final int METHOD_DEFLATED = 8;

        private final OutputStream out;
        private final ByteArrayOutputStream central = new ByteArrayOutputStream(16384);
        private long offset;
        private int count;

        private ZipWriter(OutputStream out) {
            this.out = out;
        }

        private void add(String name, byte[] data, long dosTime) throws IOException {
            byte[] nameBytes = name.getBytes(StandardCharsets.UTF_8);
            int flags = 0;
            if (!isAscii(nameBytes)) {
                flags |= FLAG_UTF8;
            }

            byte[] payload = deflate(data);
            int method = METHOD_DEFLATED;
            if (payload.length >= data.length) {
                payload = data;
                method = METHOD_STORED;
            }

            CRC32 crc = new CRC32();
            crc.update(data);
            long checksum = crc.getValue();

            byte[] local = new byte[30];
            putInt(local, 0, LOCAL_SIGNATURE);
            putShort(local, 4, VERSION);
            putShort(local, 6, flags);
            putShort(local, 8, method);
            putShort(local, 10, (int) (dosTime & 0xFFFFL));
            putShort(local, 12, (int) ((dosTime >>> 16) & 0xFFFFL));
            putInt(local, 14, checksum);
            putInt(local, 18, payload.length);
            putInt(local, 22, data.length);
            putShort(local, 26, nameBytes.length);
            putShort(local, 28, 0);

            long localOffset = offset;
            out.write(local);
            out.write(nameBytes);
            out.write(payload);
            offset += local.length + nameBytes.length + payload.length;

            byte[] header = new byte[46];
            putInt(header, 0, CENTRAL_SIGNATURE);
            putShort(header, 4, VERSION);
            putShort(header, 6, VERSION);
            putShort(header, 8, flags);
            putShort(header, 10, method);
            putShort(header, 12, (int) (dosTime & 0xFFFFL));
            putShort(header, 14, (int) ((dosTime >>> 16) & 0xFFFFL));
            putInt(header, 16, checksum);
            putInt(header, 20, payload.length);
            putInt(header, 24, data.length);
            putShort(header, 28, nameBytes.length);
            putShort(header, 30, 0);
            putShort(header, 32, 0);
            putShort(header, 34, 0);
            putShort(header, 36, 0);
            putInt(header, 38, 0);
            putInt(header, 42, (int) localOffset);

            central.write(header);
            central.write(nameBytes);
            count++;
        }

        private void finish() throws IOException {
            byte[] directory = central.toByteArray();
            out.write(directory);

            byte[] end = new byte[22];
            putInt(end, 0, END_SIGNATURE);
            putShort(end, 4, 0);
            putShort(end, 6, 0);
            putShort(end, 8, count);
            putShort(end, 10, count);
            putInt(end, 12, directory.length);
            putInt(end, 16, (int) offset);
            putShort(end, 20, 0);
            out.write(end);
            out.flush();
        }

        private int count() {
            return count;
        }

        @Override
        public void close() throws IOException {
            out.close();
        }

        private static boolean isAscii(byte[] bytes) {
            for (byte value : bytes) {
                if (value < 0) {
                    return false;
                }
            }
            return true;
        }

        private static void putShort(byte[] buffer, int index, int value) {
            buffer[index] = (byte) value;
            buffer[index + 1] = (byte) (value >>> 8);
        }

        private static void putInt(byte[] buffer, int index, long value) {
            buffer[index] = (byte) value;
            buffer[index + 1] = (byte) (value >>> 8);
            buffer[index + 2] = (byte) (value >>> 16);
            buffer[index + 3] = (byte) (value >>> 24);
        }
    }

    /**
     * Parses the class entries of a ProGuard mapping file. Member lines are indented and
     * therefore skipped: A4 renames class names only, so method/field descriptors never
     * have to be rewritten and no inheritance chain has to be resolved.
     */
    private static Map<String, String> parseClassMapping(Path file) throws IOException {
        Map<String, String> map = new LinkedHashMap<>();
        for (String raw : Files.readAllLines(file, StandardCharsets.UTF_8)) {
            if (raw.isEmpty() || raw.charAt(0) == '#' || Character.isWhitespace(raw.charAt(0))) {
                continue;
            }
            int arrow = raw.lastIndexOf("->");
            if (arrow < 0) {
                continue;
            }
            String from = raw.substring(0, arrow).trim();
            String to = raw.substring(arrow + 2).trim();
            if (to.endsWith(":")) {
                to = to.substring(0, to.length() - 1).trim();
            }
            if (from.isEmpty() || to.isEmpty()) {
                continue;
            }
            map.put(from.replace('.', '/'), to.replace('.', '/'));
        }
        return map;
    }

    private static final class ClassOnlyRemapper extends Remapper {
        private final Map<String, String> classMap;

        ClassOnlyRemapper(Map<String, String> classMap) {
            super(Opcodes.ASM9);
            this.classMap = classMap;
        }

        @Override
        public String map(String internalName) {
            String mapped = classMap.get(internalName);
            return mapped == null ? internalName : mapped;
        }
    }
}
