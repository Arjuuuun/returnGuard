import { DefaultAzureCredential } from "@azure/identity";
import { AIProjectClient } from "@azure/ai-projects";

const endpoint = "https://ai-200-foundry-arjun.services.ai.azure.com/api/projects/AI-200";
const agentName = "return-fraud-scorer";
const agentVersion = "5";

const projectClient = new AIProjectClient(endpoint, new DefaultAzureCredential());

interface AgentRiskAssessment {
    score: number;
    reasoning: string;
}

function isAgentRiskAssessment(value: unknown): value is AgentRiskAssessment {
    return (
        typeof value === "object" &&
        value !== null &&
        "score" in value &&
        typeof (value as any).score === "number" &&
        "reasoning" in value &&
        typeof (value as any).reasoning === "string"
    );
}

export async function scoreReturnWithAgent(
    returnMetadata: Record<string, unknown>,
    url: string
): Promise<{ score: number; reasoning: string }> {
    const openAIClient = projectClient.getOpenAIClient();

    const conversation = await openAIClient.conversations.create({
        items: [
            {
                type: "message",
                role: "user",
                content: [
                    {
                        type: "input_text",
                        text: `Assess fraud risk for this return. Metadata: ${JSON.stringify(returnMetadata)}`,
                    },
                    {
                        type: "input_image",
                        image_url: url,
                        detail: "high"
                    },

                ],
            },
        ],
    });

    const response = await openAIClient.responses.create(
        { conversation: conversation.id },
        { body: { agent_reference: { name: agentName, version: agentVersion, type: "agent_reference" } } }
    );

    let parsed: unknown;
    try {
        parsed = JSON.parse(response.output_text);
    } catch {
        throw new Error(`Agent response was not valid JSON: ${response.output_text}`);
    }

    if (!isAgentRiskAssessment(parsed)) {
        throw new Error(`Agent response missing expected fields: ${JSON.stringify(parsed)}`);
    }

    // parsed is now typed as AgentRiskAssessment — parsed.score and parsed.reasoning are safe
    return { score: parsed.score, reasoning: parsed.reasoning };
}