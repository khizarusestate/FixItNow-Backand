import { generateAIResponse } from "../services/aiService.js";

export async function chatWithAI(req, res) {
  try {
    const { messages } = req.body;

    if (!Array.isArray(messages)) {
      return res.status(400).json({
        success: false,
        message: "Messages must be provided as an array.",
      });
    }

    if (messages.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one message is required.",
      });
    }

    const lastMessage = messages[messages.length - 1];

    if (
      !lastMessage ||
      lastMessage.role !== "user" ||
      typeof lastMessage.content !== "string" ||
      !lastMessage.content.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid user message is required.",
      });
    }

    if (lastMessage.content.trim().length > 4000) {
      return res.status(400).json({
        success: false,
        message: "Message is too long.",
      });
    }

    const reply = await generateAIResponse(messages);

    return res.status(200).json({
      success: true,
      message: reply,
    });
  } catch (error) {
    console.error("AI chat error:", error);

    return res.status(500).json({
      success: false,
      message: "Sorry, I'm having trouble connecting right now. Please try again later.",
    });
  }
}
