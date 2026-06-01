# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# communication
- Communicate in Vietnamese mixed with English technical terms. Confidence: 0.85
- After completing a step, proceed to the next logical step without asking for confirmation. Confidence: 0.85
- When the user says "làm tiếp" or similar, decide the next best step autonomously and execute it. Confidence: 0.80
- Do not repeatedly ask "what should I do next?" — prefer autonomous decision-making about next steps. Confidence: 0.80

# code-style
- Use fs.realpath() for symlink-aware path resolution, falling back to path.resolve() when realpath fails. Confidence: 0.70

# job-queue
- When a worker claims a job, transition status to "assigned" and set the workerId field on QueueJob. Confidence: 0.70

