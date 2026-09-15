// Random GIF replies: if someone replies directly to a message from the
// bot, it automatically responds with a random GIF from GIPHY. Separate
// from gif.js (the /gif conversion command) since this is a different
// feature that just happens to also involve GIFs.
const GIF_CATEGORIES = ["tsundere", "cats", "dogs", "seals"];

async function getRandomGif() {
  const category = GIF_CATEGORIES[Math.floor(Math.random() * GIF_CATEGORIES.length)];

  const url = `https://api.giphy.com/v1/gifs/random?api_key=${process.env.GIPHY_API_KEY}&tag=${encodeURIComponent(
    category
  )}&rating=pg-13`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Giphy responded with status ${response.status}`);

  const data = await response.json();
  return data.data?.images?.original?.url ?? null;
}

export function registerGifReplyHandler(client) {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.reference) return;

    try {
      const referenced = await message.fetchReference();
      if (referenced.author.id !== client.user.id) return;

      const gifUrl = await getRandomGif();
      if (gifUrl) {
        await message.reply(gifUrl);
      }
    } catch (error) {
      console.error("Error replying with GIF:", error);
    }
  });
}
