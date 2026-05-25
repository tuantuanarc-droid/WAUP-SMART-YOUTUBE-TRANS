import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

const defaultAi = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/models", async (req, res) => {
    try {
      const models = [];
      const response = await defaultAi.models.listModels();
      for await (const m of response) {
         models.push(m.name);
      }
      res.json(models);
    } catch (e: any) {
      res.json({ error: e.toString() });
    }
  });

  app.post("/api/translate", async (req, res) => {
    try {
      const { title, description, protectedTerms, language, languages, titlesToRetry, apiKey } = req.body;
      
      const ai = apiKey ? new GoogleGenAI({ 
        apiKey: apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      }) : defaultAi;

      if (!title && !titlesToRetry) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      let systemInstruction = "";
      let contents = "";
      let responseSchema: any = {};

      if (titlesToRetry && Array.isArray(titlesToRetry)) {
         // Batch Retry logic
         const langs = titlesToRetry.map(t => t.language).join(", ");
         systemInstruction = `You are an expert YouTube content translator specializing in writing short, punchy titles.
The user is asking you to SHORTEN several YouTube video TITLES because the previous attempts were over the 100 character limit.
For each item in the list, you MUST write a new title in the specified language that is STRICTLY UNDER 100 CHARACTERS long (including spaces and emojis). 
It must be shorter than before while maintaining the clickbait "hook".

Protected terms to keep exactly as is: [${protectedTerms ? protectedTerms : "None provided"}]

Always output your result as a JSON object containing an array designated by the 'shortenedTitles' key. Each item must have 'language' and 'title'.`;
         
         contents = "Titles to shorten:\n" + titlesToRetry.map(t => `${t.language}: ${t.title}`).join("\n");
         
         responseSchema = {
           type: Type.OBJECT,
           properties: {
             shortenedTitles: {
               type: Type.ARRAY,
               items: {
                 type: Type.OBJECT,
                 properties: {
                   language: { type: Type.STRING },
                   title: { type: Type.STRING, description: "Strictly under 100 characters" }
                 },
                 required: ["language", "title"]
               }
             }
           },
           required: ["shortenedTitles"]
         };
      } else {
         // Initial Translation Batch logic
         const targetLangs = languages ? languages.join(", ") : language;
         systemInstruction = `You are an expert YouTube content translator. You will translate a YouTube video title and description into the following languages: ${targetLangs}.
Your goal is to understand the context as a human would, rather than just doing a word-for-word translation.

Crucial Directives:
1. TITLE CHARACTER LIMIT: The translated title MUST be under 100 characters (including spaces and emojis) for EACH language. If the direct translation is longer, you MUST skillfully summarize, use shorter synonyms, remove filler words, or alter the sentence structure to maintain the 'hook' or clickbait feel without exceeding the limit. THIS IS STRICT.
2. DESCRIPTION: Translate the description freely without any length limits. Focus on accuracy, natural phrasing, and tone.
3. PROTECTED TERMS: You MUST NOT translate, modify, or remove any of the following protected terms:
[${protectedTerms ? protectedTerms : "None provided"}]
Keep these terms exactly as they are in the translated text.

Always output your result as a JSON object, adhering exactly to the schema provided.`;

         contents = `Original Title:\n${title}\n\nOriginal Description:\n${description}`;
         responseSchema = {
            type: Type.OBJECT,
            properties: {
              translations: {
                type: Type.ARRAY,
                description: "Array of translations for each requested language",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    language: { type: Type.STRING, description: "The language name" },
                    title: { type: Type.STRING, description: "Under 100 characters strictly" },
                    description: { type: Type.STRING }
                  },
                  required: ["language", "title", "description"]
                }
              }
            },
            required: ["translations"]
         };
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contents,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        },
      });

      const text = response.text || "{}";
      const result = JSON.parse(text);

      res.json(result);
    } catch (error: any) {
      let retryDelay: number | null = null;
      let is429 = false;
      let is503 = false;
      
      try {
        const errorMsg = error?.toString() || "";
        
        // Try to parse ApiError JSON
        let errorBody: any = {};
        try {
          if (errorMsg.includes('ApiError: {')) {
             const jsonStr = errorMsg.substring(errorMsg.indexOf('{'));
             errorBody = JSON.parse(jsonStr);
          } else if (error.message && error.message.startsWith('{')) {
             errorBody = JSON.parse(error.message);
          }
        } catch(e) {}
        
        const innerError = errorBody.error || {};

        if (innerError.code === 429 || error?.status === 429 || errorMsg.includes("429") || innerError.status === "RESOURCE_EXHAUSTED") {
            is429 = true;
        }
        if (innerError.code === 503 || error?.status === 503 || errorMsg.includes("503") || errorMsg.includes("UNAVAILABLE")) {
            is503 = true;
        }

        const match = errorMsg.match(/retry in (\d+(?:\.\d+)?)s/i);
        if (match && match[1]) {
           retryDelay = Math.ceil(parseFloat(match[1]));
        } else if (innerError.details) {
           const retryInfo = innerError.details.find((d: any) => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
           if (retryInfo && retryInfo.retryDelay) {
              retryDelay = parseInt(retryInfo.retryDelay);
           }
        }
      } catch(e) {}
      
      if (is429) {
        console.warn(`[API INFO] Rate limit (429) reached. Delay: ${retryDelay || 'unknown'}s. Instructing client to retry gracefully.`);
        if (retryDelay) res.setHeader('Retry-After', retryDelay);
        return res.status(429).json({ error: "Rate limit exceeded" });
      }
      
      if (is503) {
        console.warn(`[API INFO] Service unavailable (503). Delay: ${retryDelay || 'unknown'}s. Instructing client to retry gracefully.`);
        if (retryDelay) res.setHeader('Retry-After', retryDelay);
        return res.status(503).json({ error: "Service unavailable: High demand" });
      }

      console.error("Translation error (Unhandled):", error);
      res.status(500).json({ error: error?.toString() || "Failed to translate content" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
