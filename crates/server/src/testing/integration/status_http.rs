use crate::testing::helpers::{create_router, create_test_app_state};

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

#[tokio::test]
async fn status_returns_200_without_auth() {
    let state = create_test_app_state().await;
    let app = create_router(state);

    let req = Request::builder()
        .method("GET")
        .uri("/status")
        .body(Body::empty())
        .unwrap();

    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let bytes = to_bytes(res.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

    assert_eq!(json["status"], "ok");
    assert!(json["version"].is_string());
    assert!(json["git_commit"].is_string());
    assert!(json["network"].is_string());
    assert!(json["started_at"].is_string());
    assert!(json["uptime_seconds"].is_number());

    // Must not leak any dashboard/inventory fields.
    assert!(json.get("total_account_count").is_none());
    assert!(json.get("accounts_by_auth_method").is_none());
}
