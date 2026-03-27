/* ===== API CONFIG ===== */

const DEFAULT_API_BASE_URL = window.location.protocol === "file:" ? "http://localhost:3000" : "";
const RAW_API_BASE_URL = typeof window.__API_BASE_URL__ === "string" ? window.__API_BASE_URL__ : DEFAULT_API_BASE_URL;
const API_BASE_URL = RAW_API_BASE_URL.trim().replace(/\/+$/, "");

function buildApiUrl(path) {
    return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

/* ===== СМЕНА ТЕМЫ ===== */

function toggleTheme() {
    document.body.classList.toggle("dark");

    const icon = document.getElementById("theme-icon");
    icon.textContent = document.body.classList.contains("dark") ? "🌙" : "🌞";
}

/* ===== ОЧИСТКА ФОРМЫ ===== */

function clearForm() {
    document.getElementById("brand").value = "";
    document.getElementById("model").value = "";
    document.getElementById("year").value = "";
    document.getElementById("engine").value = "Бензин";
    document.getElementById("trans").value = "АКПП";
    document.getElementById("symptoms").value = "";
    document.getElementById("errors").value = "";
    document.getElementById("result").innerHTML = "";
}

/* ===== ГЕНЕРАЦИЯ ОТЧЁТА ===== */

async function generate() {
    const resultBox = document.getElementById("result");

    // Собираем значения всех полей формы.
    const brand = document.getElementById("brand").value.trim();
    const model = document.getElementById("model").value.trim();
    const yearRaw = document.getElementById("year").value.trim();
    const engine = document.getElementById("engine").value.trim();
    const trans = document.getElementById("trans").value.trim();
    const symptoms = document.getElementById("symptoms").value.trim();
    const errors = document.getElementById("errors").value.trim();

    // Минимальная клиентская валидация до запроса на сервер.
    if (!brand || !symptoms) {
        alert("Заполните марку и симптомы!");
        return;
    }

    const year = parseInt(yearRaw) || (new Date().getFullYear() - 5);
    const payload = {
        brand,
        model,
        year,
        engine,
        trans,
        symptoms,
        errors
    };

    resultBox.innerHTML = "⏳ Анализирую данные...";

    try {
        const response = await fetch(buildApiUrl("/api/diagnose"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        let data = null;
        try {
            data = await response.json();
        } catch (_parseErr) {
            throw new Error("Сервер вернул некорректный JSON");
        }

        if (!response.ok || !data?.success) {
            const serverMessage = data?.error?.message || "Ошибка сервера при диагностике";
            throw new Error(serverMessage);
        }

        const diagnosisText = String(data.diagnosis || "").trim();
        if (!diagnosisText) {
            throw new Error("Пустой ответ от AI");
        }

        // Отображаем переносы строк в HTML.
        resultBox.innerHTML = diagnosisText.replace(/\n/g, "<br>");
    } catch (err) {
        const message = err instanceof Error ? err.message : "Неизвестная ошибка";
        resultBox.innerHTML = `❌ ${message}`;
    }
}

/* ===== PDF ОТЧЁТ ===== */

async function downloadPDF() {
    const resultBox = document.getElementById("result");
    // Приводим HTML-ответ (с <br>) к обычному тексту для PDF.
    const result = resultBox.innerText.trim();

    if (!result) {
        alert("Сначала сформируй диагностику!");
        return;
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
        unit: "px",
        format: "a4"
    });

    let y = 30;
    pdf.setFontSize(16);
    pdf.text("AutoDiag AI PRO — Отчёт диагностики", 20, y);
    y += 20;

    pdf.setFontSize(12);
    const lines = pdf.splitTextToSize(result, 380);

    lines.forEach(line => {
        pdf.text(line, 20, y);
        y += 18;
    });

    pdf.save("diagnostic-report.pdf");
}
