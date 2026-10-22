
export async function translateText(
  text: string,
  targetLanguage: string,
  sourceLanguage = "en",
): Promise<string> {
  if (!text || !text.trim() || sourceLanguage === targetLanguage) {
    return text;
  }

  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;

  if (!apiKey) {
    throw new Error("GOOGLE_TRANSLATE_API_KEY is not configured");
  }

  const response = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: text,
        source: sourceLanguage,
        target: targetLanguage,
        format: "text",
      }),
    },
  );

  const result = await response.json() as {
    data?: {
      translations?: { translatedText: string }[];
    };
    error?: { message: string };
  };

  if (!response.ok) {
    throw new Error(result.error?.message || "Translation failed");
  }

  return result.data?.translations?.[0]?.translatedText ?? text;
}