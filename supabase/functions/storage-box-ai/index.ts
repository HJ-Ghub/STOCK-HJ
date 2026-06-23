import { createClient } from 'npm:@supabase/supabase-js@2';

const FUNCTION_NAME = 'storage-box-ai';
const MAX_IMAGE_DATA_URL_CHARS = 3500000;
const MAX_BOXES = 80;
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX = 8;
const allowedOrigins = new Set([
  'https://hj-ghub.github.io',
  'http://127.0.0.1:4177',
  'http://localhost:4177',
  'http://127.0.0.1:5173',
  'http://localhost:5173'
]);
const rateBuckets = new Map();

function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const allowedOrigin = allowedOrigins.has(origin) ? origin : 'https://hj-ghub.github.io';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function isAllowedOrigin(req) {
  const origin = req.headers.get('origin') || '';
  return !origin || allowedOrigins.has(origin);
}

function json(req, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function getSupabaseAnonKey() {
  const legacy = Deno.env.get('SUPABASE_ANON_KEY');
  if (legacy) return legacy;
  const publishable = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (!publishable) return '';
  try {
    const keys = JSON.parse(publishable);
    if (typeof keys.anon === 'string') return keys.anon;
    return Object.values(keys).find((value) => typeof value === 'string' && value) || '';
  } catch {
    return '';
  }
}

async function getUser(req) {
  const authHeader = req.headers.get('authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) throw new Error('로그인이 필요합니다.');
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = getSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) throw new Error('Supabase 인증 환경변수가 없습니다.');
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false }
  });
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user) throw new Error('로그인이 필요합니다.');
  return data.user;
}

function rateLimit(userId) {
  const now = Date.now();
  const current = rateBuckets.get(userId) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > current.resetAt) {
    current.count = 0;
    current.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  current.count += 1;
  rateBuckets.set(userId, current);
  if (current.count > RATE_LIMIT_MAX) throw new Error('AI 확인 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
}

function normalizeBoxes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_BOXES)
    .map((box) => ({
      id: String(box?.id || '').slice(0, 80),
      name: String(box?.name || '').trim().slice(0, 60)
    }))
    .filter((box) => box.name);
}

function validateImageDataUrl(value) {
  const text = String(value || '');
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(text)) throw new Error('분석할 수 없는 사진 형식입니다.');
  if (text.length > MAX_IMAGE_DATA_URL_CHARS) throw new Error('사진이 너무 큽니다.');
  return text;
}

function extractOutputText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const parts = [];
  for (const output of data?.output || []) {
    for (const content of output?.content || []) {
      if (typeof content?.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

function normalizeSuggestion(raw, boxes) {
  const fallbackBox = boxes[0]?.name || '미지정';
  const tags = Array.isArray(raw?.tags) ? raw.tags : [];
  return {
    name: String(raw?.name || '이름 확인 필요').trim().slice(0, 80),
    description: String(raw?.description || '').trim().slice(0, 240),
    tags: tags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 5),
    boxName: String(raw?.boxName || fallbackBox).trim().slice(0, 60),
    confidence: Math.max(0, Math.min(1, Number(raw?.confidence || 0))),
    needsUserCheck: Boolean(raw?.needsUserCheck)
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (!isAllowedOrigin(req)) return json(req, 403, { error: '허용되지 않은 출처입니다.' });
  if (req.method !== 'POST') return json(req, 405, { error: 'POST 요청만 사용할 수 있습니다.' });

  try {
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY') || '';
    if (!openaiApiKey) throw new Error('Missing OPENAI_API_KEY');

    const user = await getUser(req);
    rateLimit(user.id);

    const body = await req.json();
    const imageDataUrl = validateImageDataUrl(body?.imageDataUrl);
    const boxes = normalizeBoxes(body?.boxes);
    const boxNames = boxes.map((box) => box.name);
    const prompt = [
      '사진 속 보관 물건을 한국어로 짧고 실용적으로 식별해 주세요.',
      '정확하지 않으면 단정하지 말고 일반적인 이름을 사용하세요.',
      '사람, 카드, 문서, 주소, 전화번호 같은 민감 정보는 추출하거나 설명하지 마세요.',
      `가능하면 다음 보관박스 중 하나를 boxName으로 고르세요: ${boxNames.join(', ') || '미지정'}`,
      '반드시 JSON 스키마에 맞게 답하세요.'
    ].join('\n');

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_MODEL') || 'gpt-5.5',
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: imageDataUrl }
          ]
        }],
        text: {
          format: {
            type: 'json_schema',
            name: 'storage_item_guess',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  maxItems: 5
                },
                boxName: { type: 'string' },
                confidence: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1
                },
                needsUserCheck: { type: 'boolean' }
              },
              required: ['name', 'description', 'tags', 'boxName', 'confidence', 'needsUserCheck']
            }
          }
        },
        max_output_tokens: 500
      })
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || `${FUNCTION_NAME} OpenAI 요청 실패`;
      return json(req, response.status, { error: message });
    }

    const outputText = extractOutputText(data);
    const parsed = JSON.parse(outputText);
    const suggestion = normalizeSuggestion(parsed, boxes);
    return json(req, 200, { suggestion });
  } catch (err) {
    const message = err?.message || String(err);
    const status = /로그인|JWT|Unauthorized/i.test(message) ? 401 : (/너무 많/.test(message) ? 429 : 400);
    return json(req, status, { error: message });
  }
});
