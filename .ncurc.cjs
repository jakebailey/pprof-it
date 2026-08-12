// @ts-check
module.exports = {
    // oxlint-disable-next-line no-unused-vars
    target: (dependencyName, [{ semver, version, operator, major, minor, patch, release, build }]) => {
        if (dependencyName === "@types/node") return "minor";
        if (dependencyName === "npm") return "minor";
        if (major === "0") return "minor";
        return "latest";
    },
    reject: ["@datadog/pprof"],
};
