exports.inputSchema = z.object({
  userPick: z.number().int().min(1).max(1000000)
});

exports.default = function (input) {
  try {
    const parsed = exports.inputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: "Invalid input: userPick must be an integer from 1 to 1,000,000." };
    }

    const userPick = parsed.data.userPick;
    const drawnNumber = Math.floor(Math.random() * 1000000) + 1;
    const isWinner = drawnNumber === userPick;

    return {
      isWinner: isWinner,
      message: isWinner
        ? "Congratulations! You won the lottery!"
        : "Sorry, you did not win this time. Better luck next time!"
    };
  } catch (e) {
    return { error: "Unexpected error while running lottery tool." };
  }
};