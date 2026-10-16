# GitHub file-size safety

Full funding JSONL exports and combined national procurement exports remain local because the collectors use them. Publish the funding manifest and its listed `.part-*.jsonl` files; use the validated Procurement-Master for procurement. Never upload both full and split copies.

The repository hooks block blobs of 95 MiB or larger at commit and push. On a new clone install them with `git config --local core.hooksPath .githooks`. Hooks require Node.js and can be bypassed by users; they are not a server policy. Existing procurement publication also performs its own file-size check.
