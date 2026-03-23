import express from "express";
import cors from "cors";
import OpenAI from "openai";
import dotenv from "dotenv";


class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

dotenv.config();

console.log(
  "OPENAI_API_KEY:",
  process.env.OPENAI_API_KEY ? "loaded" : "not loaded"
);

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY не найден!");
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "64kb" }));

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function normalizeToString(value, fieldName) {
  if (value === undefined || value === null) {
    throw new ValidationError(`${fieldName} обязателен`);
  }
  if (typeof value !== "string") {
    // Разрешаем числа/булевы только как строковое представление.
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    throw new ValidationError(`${fieldName} должно быть строкой`);
  }

  const s = value.trim();
  if (!s) throw new ValidationError(`${fieldName} должно быть непустой строкой`);
  return s;
}

function normalizeSymptomsOrErrors(value, fieldName) {
  // Допускаем строку или массив строк.
  if (value === undefined || value === null) {
    throw new ValidationError(`${fieldName} обязателен`);
  }

  const arr = Array.isArray(value) ? value : [value];
  const normalized = arr
    .map((v) => {
      if (v === undefined || v === null) return "";
      if (typeof v === "string") return v.trim();
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      return "";
    })
    .filter(Boolean);

  if (normalized.length === 0) {
    throw new ValidationError(
      `${fieldName} должен быть непустой строкой или массивом строк`,
    );
  }

  const maxItems = 20;
  const trimmed = normalized.slice(0, maxItems);
  return trimmed;
}

function validatePayload(body) {
  if (!body || typeof body !== "object") {
    throw new ValidationError("Тело запроса должно быть JSON-объектом");
  }

  const brand = normalizeToString(body.brand, "brand");
  const model = normalizeToString(body.model, "model");
  const yearRaw = body.year;
  const engine = normalizeToString(body.engine, "engine");
  const trans = normalizeToString(body.trans, "trans");
  const symptoms = normalizeSymptomsOrErrors(body.symptoms, "symptoms");
  const errors = normalizeSymptomsOrErrors(body.errors, "errors");

  const year = Number(yearRaw);
  if (!Number.isInteger(year)) throw new ValidationError("year должен быть целым числом");
  const currentYear = new Date().getFullYear();
  if (year < 1950 || year > currentYear + 1) {
    throw new ValidationError(`year должен быть в диапазоне от 1950 до ${currentYear + 1}`);
  }

  const limit = (s, maxLen) => (s.length > maxLen ? s.slice(0, maxLen) : s);
  return {
    brand: limit(brand, 80),
    model: limit(model, 80),
    year,
    engine: limit(engine, 120),
    trans: limit(trans, 80),
    symptoms: symptoms.map((x) => (x.length > 200 ? x.slice(0, 200) : x)),
    errors: errors.map((x) => (x.length > 200 ? x.slice(0, 200) : x)),
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/diagnose", async (req, res) => {
  try {
    const payload = validatePayload(req.body);

    const prompt = [
      "Ты — профессиональный автодиагност (эксперт по диагностике неисправностей).",
      "Твоя задача — по вводным данным пользователя дать наиболее вероятный диагноз, возможные причины и ближайшие проверки.",
      "",
      "Требования к ответу:",
      "1) Пиши на русском, профессионально и по делу.",
      "2) Сначала укажи краткий итог (1-2 предложения).",
      "3) Затем перечисли 3-6 наиболее вероятных причин по убыванию вероятности.",
      "4) Для каждой причины добавь коротко: что проверить/какие симптомы подтвердят.",
      "5) В конце предложи план действий: что сделать в первую очередь (приоритет), и отдельно — что делать только после проверок (безопасность).",
      "6) Не выдавай себя за гарантию: используй формулировки вероятности и предложи проверки.",
      "7) Если недостаточно данных — явно перечисли, каких уточнений не хватает.",
      "",
      "Входные данные автодиагностики (автомобиль пользователя):",
      `- Марка: ${payload.brand}`,
      `- Модель: ${payload.model}`,
      `- Год: ${payload.year}`,
      `- Двигатель: ${payload.engine}`,
      `- КПП/трансмиссия: ${payload.trans}`,
      `- Симптомы: ${payload.symptoms.join("; ")}`,
      `- Ошибки (коды/описания): ${payload.errors.join("; ")}`,
      "",
      "Сформируй диагноз по этим данным.",
    ].join("\n");

    let completion;
    try {
      const openaiChatCompletionsUrl =
        "https://api.openai.com/v1/chat/completions";
      const model = "gpt-3.5-turbo";
      const apiKey = process.env.OPENAI_API_KEY || "";

      // Делаем максимально подробный лог для диагностики проблем ключа/доступа.
      console.log(
        "🔗 OpenAI request URL:",
        openaiChatCompletionsUrl,
      );
      console.log("🧠 OpenAI model:", model);
      console.log(
        "🔑 OPENAI_API_KEY prefix:",
        apiKey ? apiKey.slice(0, 12) + "..." : "EMPTY",
        "(len=" + apiKey.length + ")",
      );

      completion = await openaiClient.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content:
              "Ты автодиагност. Отвечай структурировано, кратко и безопасно, не давай опасных советов.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 800,
      });
      console.log("✅ Ответ от OpenAI получен");
    } catch (openaiErr) {
      const msg = openaiErr?.message || String(openaiErr);
      const statusCode = openaiErr?.status || openaiErr?.statusCode;
      const type = openaiErr?.type;
      const code = openaiErr?.code;
      const responseStatus = openaiErr?.response?.status;
      const responseData = openaiErr?.response?.data;

      console.error("❌ OpenAI error text:", msg);
      console.error("❌ OpenAI status code:", statusCode ?? responseStatus ?? "unknown");
      console.error("❌ OpenAI error type:", type ?? "unknown");
      console.error("❌ OpenAI error code:", code ?? "unknown");
      if (responseData) {
        console.error("❌ OpenAI error response.data:", responseData);
      }

      // Полный объект ошибки (без секретов, SDK обычно маскирует).
      console.error("❌ OpenAI error object:", openaiErr);

      return res.status(502).json({
        success: false,
        error: {
          message: msg,
        },
      });
    }

    const diagnosis = completion?.choices?.[0]?.message?.content?.trim();
    if (!diagnosis) {
      return res.status(502).json({
        success: false,
        error: { message: "AI вернул пустой ответ" },
      });
    }

    return res.json({ success: true, diagnosis });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = err instanceof ValidationError ? 400 : 500;

    return res.status(status).json({
      success: false,
      error: {
        message,
      },
    });
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () =>
  console.log(`Server started on http://localhost:${port}`),
);
