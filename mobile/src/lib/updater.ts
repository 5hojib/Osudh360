import Constants from "expo-constants";
import * as Application from "expo-application";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";

const GITHUB_REPO = "5hojib/Osudh360";

export type UpdateInfo = {
  version: string;
  name: string;
  downloadUrl: string;
};

function parseVersion(v: string): number[] {
  return v.split(".").map((part) => Number(part.replace(/\D/g, "")) || 0);
}

function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const currentVersion = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "0";
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const json = (await res.json()) as { tag_name?: string; assets?: { name?: string; browser_download_url?: string }[] };
  const candidate = (json.tag_name ?? "").replace(/^v/, "");
  if (!candidate || !isNewer(candidate, currentVersion)) return null;

  const asset = (json.assets ?? []).find(
    (a) => typeof a.name === "string" && a.name.endsWith(".apk") && typeof a.browser_download_url === "string",
  );
  if (!asset?.browser_download_url) return null;

  return { version: candidate, name: asset.name ?? `osudh360-${candidate}.apk`, downloadUrl: asset.browser_download_url };
}

export async function downloadAndInstall(update: UpdateInfo, onProgress?: (ratio: number) => void): Promise<void> {
  if (!FileSystem.cacheDirectory) throw new Error("No cache directory");
  const fileUri = `${FileSystem.cacheDirectory}${update.name}`;

  const download = FileSystem.createDownloadResumable(
    update.downloadUrl,
    fileUri,
    {},
    (progress) => {
      if (progress.totalBytesExpectedToWrite > 0 && onProgress) {
        onProgress(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
      }
    },
  );
  const result = await download.downloadAsync();
  if (!result?.uri) throw new Error("Download failed");

  const contentUri = await FileSystem.getContentUriAsync(result.uri);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: "application/vnd.android.package-archive",
    flags: 1,
  });
}