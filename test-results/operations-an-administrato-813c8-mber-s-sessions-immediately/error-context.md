# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: operations.spec.ts >> an administrator can revoke another member's sessions immediately
- Location: tests/e2e/operations.spec.ts:120:5

# Error details

```
Test timeout of 90000ms exceeded.
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e2]:
    - generic [ref=e3]:
      - link "Operanto" [ref=e4] [cursor=pointer]:
        - /url: /
      - generic [ref=e5]:
        - heading "Sign in" [level=1] [ref=e6]
        - paragraph [ref=e7]: Access is by invitation. Contact your administrator if you need an account.
        - generic [ref=e8]:
          - generic [ref=e9]:
            - generic [ref=e10]: Email
            - textbox "Email" [ref=e11]
          - generic [ref=e12]:
            - generic [ref=e13]: Password
            - textbox "Password" [ref=e14]
          - alert [ref=e15]: Invalid email or password.
          - button "Sign in" [ref=e16]
  - alert [ref=e17]
```