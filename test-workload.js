const values = Array.from({ length: 100_000 }, (_, index) => Math.sqrt(index));
const checksum = values.reduce((sum, value) => sum + value, 0);

if (!Number.isFinite(checksum)) {
    throw new Error("invalid checksum");
}
