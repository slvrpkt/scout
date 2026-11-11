# Contributing to Scout

Glad you're here. Found a bug or have an idea? Use the issue forms. This page covers pull requests. [DEVELOPMENT.md](DEVELOPMENT.md) explains how to set Scout up and run its tests.

## 1. Talk it through in an issue before building a feature

Scout is meant to stay simple and useful for people looking for work, so every new feature starts with a conversation. Before you write code for a feature, or for a change to how something works today, open an issue and tell me:

- what problem it solves, and for whom;
- roughly how you'd go about it.

Once we agree it belongs in Scout and how it should work, go ahead and build it. A feature pull request without that agreed issue behind it will be closed. Some limits and defaults are deliberate, such as the starting spending limits, which keep people's API bills small.

Bug fixes and small corrections to text or docs don't need an issue. Send those straight as a pull request.

## 2. New AI providers and job sources: check first, and protect people's data

- **Try what's already there.** Most AI services work through Scout's **OpenAI-compatible** provider (enter the server's address, your key and the model). Only propose a new provider if that genuinely can't work, and say in the issue what you tried.
- **Job sources get the search, nothing more:** keywords, place and filters. Never a name, profile, resume or applications. Searches go from Scout's server, not the browser. Check the source's privacy policy and terms before you start, link them in the issue, and add the source to [PRIVACY.md](PRIVACY.md).

## What happens to your pull request

1. You open a pull request.
2. When I get a chance, I look at it and test it. I can't promise a timeframe: it could be days or it could be weeks.
3. If it makes sense for Scout, I bring it into the next release myself and credit you in the release notes. Your pull request is then closed with a link to that release, rather than merged.

Thanks for helping make Scout better.
