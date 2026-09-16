# Answering ACP requests

`read_task` and `wait` return `pending_requests` containing the bridge `request_id`, Cursor method, and original parameters. Pass the bridge request ID to `respond`. These IDs are valid only while the live request exists.

For `session/request_permission`, choose an `optionId` actually present in `params.options`:

```json
{"outcome":{"outcome":"selected","optionId":"allow-once"}}
```

To cancel that request: `{"outcome":{"outcome":"cancelled"}}`.

Cursor's documented `cursor/ask_question` response is:

```json
{"outcome":{"outcome":"answered","answers":[{"questionId":"q1","selectedOptionIds":["option-1"]}]}}
```

Use IDs from the received questions/options. A skipped question can use `{"outcome":{"outcome":"skipped","reason":"..."}}`. Some older Cursor clients use `{"answers":{"q1":"answer text"}}`; the bridge forwards the response object unchanged so the shape can match the installed CLI. A question can also be cancelled with `{"outcome":{"outcome":"cancelled"}}`.

For `cursor/create_plan`, current documented responses include `{"outcome":{"outcome":"accepted"}}`, `{"outcome":{"outcome":"rejected","reason":"..."}}`, and `{"outcome":{"outcome":"cancelled"}}`. Older clients may use `{"accepted":true}`.

Source: [Cursor ACP extensions](https://cursor.com/docs/cli/acp). The read/write task smoke test does not by itself validate all question and plan extension versions.
