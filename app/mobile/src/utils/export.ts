import { Platform, Share } from "react-native";
export async function exportText(
  name: string,
  text: string,
  mime = "text/plain",
) {
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else {
    await Share.share({ title: name, message: text });
  }
}
