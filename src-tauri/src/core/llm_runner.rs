use std::time::Duration;

use anyhow::{Context, Result};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

pub fn run_llm(
    provider_type: &str,
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String> {
    match provider_type {
        "openai" => run_openai_chat(base_url, api_key, model, system_prompt, user_prompt),
        "anthropic" => run_anthropic_messages(base_url, api_key, model, system_prompt, user_prompt),
        "gemini" => run_gemini_generate_content(base_url, api_key, model, system_prompt, user_prompt),
        _ => anyhow::bail!("unsupported provider type: {}", provider_type),
    }
}

fn http_client() -> Result<Client> {
    Ok(Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .context("build http client")?)
}

#[derive(Debug, Serialize)]
struct OpenAIChatRequest<'a> {
    model: &'a str,
    messages: Vec<OpenAIMessage<'a>>,
    temperature: f32,
}

#[derive(Debug, Serialize)]
struct OpenAIMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Debug, Deserialize)]
struct OpenAIChatResponse {
    choices: Vec<OpenAIChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAIChoice {
    message: OpenAIResponseMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAIResponseMessage {
    content: Option<String>,
}

fn run_openai_chat(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String> {
    let client = http_client()?;
    let base = base_url.trim_end_matches('/');
    let url = format!("{}/chat/completions", base);

    let body = OpenAIChatRequest {
        model,
        messages: vec![
            OpenAIMessage {
                role: "system",
                content: system_prompt,
            },
            OpenAIMessage {
                role: "user",
                content: user_prompt,
            },
        ],
        temperature: 0.2,
    };

    let mut req = client.post(url).header("User-Agent", "skills-hub");
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }

    let resp = req
        .json(&body)
        .send()
        .context("OpenAI-compatible request failed")?;
    let status = resp.status();
    let text = resp.text().context("read OpenAI-compatible response")?;
    if !status.is_success() {
        anyhow::bail!("OpenAI-compatible error ({}): {}", status, text);
    }
    let parsed: OpenAIChatResponse =
        serde_json::from_str(&text).context("parse OpenAI-compatible response")?;
    let content = parsed
        .choices
        .into_iter()
        .next()
        .and_then(|c| c.message.content)
        .unwrap_or_default();
    if content.trim().is_empty() {
        anyhow::bail!("OpenAI-compatible response is empty");
    }
    Ok(content)
}

#[derive(Debug, Serialize)]
struct AnthropicMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Debug, Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: &'a str,
    messages: Vec<AnthropicMessage<'a>>,
    temperature: f32,
}

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContentBlock>,
}

#[derive(Debug, Deserialize)]
struct AnthropicContentBlock {
    #[serde(rename = "type")]
    type_: String,
    text: Option<String>,
}

fn run_anthropic_messages(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String> {
    let Some(key) = api_key else {
        anyhow::bail!("Anthropic API key is missing (configure provider api_key or api_key_env)");
    };
    let client = http_client()?;
    let base = base_url.trim_end_matches('/');
    let url = format!("{}/v1/messages", base);

    let body = AnthropicRequest {
        model,
        max_tokens: 4096,
        system: system_prompt,
        messages: vec![AnthropicMessage {
            role: "user",
            content: user_prompt,
        }],
        temperature: 0.2,
    };

    let resp = client
        .post(url)
        .header("User-Agent", "skills-hub")
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .context("Anthropic request failed")?;
    let status = resp.status();
    let text = resp.text().context("read Anthropic response")?;
    if !status.is_success() {
        anyhow::bail!("Anthropic error ({}): {}", status, text);
    }
    let parsed: AnthropicResponse = serde_json::from_str(&text).context("parse Anthropic response")?;
    let content = parsed
        .content
        .into_iter()
        .find_map(|b| if b.type_ == "text" { b.text } else { None })
        .unwrap_or_default();
    if content.trim().is_empty() {
        anyhow::bail!("Anthropic response is empty");
    }
    Ok(content)
}

#[derive(Debug, Serialize)]
struct GeminiPart<'a> {
    text: &'a str,
}

#[derive(Debug, Serialize)]
struct GeminiContent<'a> {
    parts: Vec<GeminiPart<'a>>,
}

#[derive(Debug, Serialize)]
struct GeminiRequest<'a> {
    contents: Vec<GeminiContent<'a>>,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiRespContent>,
}

#[derive(Debug, Deserialize)]
struct GeminiRespContent {
    parts: Vec<GeminiRespPart>,
}

#[derive(Debug, Deserialize)]
struct GeminiRespPart {
    text: Option<String>,
}

fn run_gemini_generate_content(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String> {
    let Some(key) = api_key else {
        anyhow::bail!("Gemini API key is missing (configure provider api_key or api_key_env)");
    };
    let client = http_client()?;
    let base = base_url.trim_end_matches('/');
    let url = format!("{}/v1beta/models/{}:generateContent?key={}", base, model, key);

    let merged = format!("{}\n\n---\n\n{}", system_prompt.trim(), user_prompt.trim());
    let body = GeminiRequest {
        contents: vec![GeminiContent {
            parts: vec![GeminiPart { text: &merged }],
        }],
    };

    let resp = client
        .post(url)
        .header("User-Agent", "skills-hub")
        .json(&body)
        .send()
        .context("Gemini request failed")?;
    let status = resp.status();
    let text = resp.text().context("read Gemini response")?;
    if !status.is_success() {
        anyhow::bail!("Gemini error ({}): {}", status, text);
    }
    let parsed: GeminiResponse = serde_json::from_str(&text).context("parse Gemini response")?;
    let mut out = String::new();
    if let Some(first) = parsed.candidates.into_iter().next() {
        if let Some(content) = first.content {
            for part in content.parts {
                if let Some(t) = part.text {
                    out.push_str(&t);
                }
            }
        }
    }
    if out.trim().is_empty() {
        anyhow::bail!("Gemini response is empty");
    }
    Ok(out)
}
