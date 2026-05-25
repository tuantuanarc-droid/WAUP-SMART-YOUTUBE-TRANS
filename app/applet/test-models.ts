import { GoogleGenAI } from "@google/genai";
async function run() {
  const ai = new GoogleGenAI();
  const res = await ai.models.generateContent({
    model: "gemini-1.5-flash-8b",
    contents: "Hello"
  });
  console.log(res.text);
}
run();
