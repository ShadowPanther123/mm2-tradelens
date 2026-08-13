/** Browser download/upload helpers shared by the export/import features. */

/** Trigger a download of a text file with the given name and MIME type. */
export function downloadTextFile(
  filename: string,
  text: string,
  mime = "application/json",
): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Prompt the user to pick a text file and resolve with its contents, or null if
 * the picker was dismissed. Uses a transient hidden `<input type="file">`.
 */
export function pickTextFile(
  accept = "application/json,.json",
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () =>
        reject(reader.error ?? new Error("Could not read the file."));
      reader.readAsText(file);
    });
    document.body.appendChild(input);
    input.click();
  });
}
