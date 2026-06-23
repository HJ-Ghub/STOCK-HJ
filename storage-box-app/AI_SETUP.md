# 보관앱 AI 사진 확인 설정

보관앱의 브라우저 화면에는 OpenAI API KEY를 넣지 않습니다. 사진은 로그인한 사용자만 Supabase Edge Function `storage-box-ai`로 보내고, 함수 안에서만 OpenAI API KEY를 사용합니다.

## Supabase에 설정할 값

Supabase Dashboard에서 Edge Function Secrets에 아래 값을 추가하세요.

```text
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.5
```

`OPENAI_MODEL`은 선택값입니다. 비워두면 함수에서 `gpt-5.5`를 사용합니다.

## 배포

Supabase CLI를 사용하는 경우:

```powershell
supabase login
supabase link --project-ref <프로젝트 ref>
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set OPENAI_MODEL=gpt-5.5
supabase functions deploy storage-box-ai
```

Dashboard에서 직접 Edge Function을 만들 경우 함수 이름은 반드시 `storage-box-ai`로 만들고, `supabase/functions/storage-box-ai/index.ts` 내용을 붙여 넣어 배포하세요.

## 동작 방식

1. 앱에서 사진을 찍거나 선택합니다.
2. 앱은 로그인된 Supabase 세션으로 `storage-box-ai`를 호출합니다.
3. 함수가 사용자 JWT를 확인한 뒤 OpenAI에 사진을 전달합니다.
4. 앱은 추정된 물건명, 설명, 태그, 보관박스를 팝업으로 보여줍니다.
5. 사용자가 `적용`을 눌러야 입력칸에 반영됩니다.

민감한 문서, 카드, 신분증, 주소 등이 사진에 같이 찍히지 않도록 주의하세요.
