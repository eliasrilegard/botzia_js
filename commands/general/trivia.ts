import { Message, MessageEmbed, MessageReaction, User } from 'discord.js';
import fetch from 'node-fetch';
import Bot from '../../bot/bot';
import Command from '../../bot/command';

interface TriviaCategory {
  id: number;
  name: string;
}

interface TriviaQuestion {
  category: string;
  type: string;
  difficulty: string;
  question: string;
  correct_answer: string;
  incorrect_answers: Array<string>;
}

class Trivia extends Command {
  private triviaCategories: Array<TriviaCategory>;

  public constructor() {
    super('trivia', 'Play a game of trivia!', '[category] OR --categories to list all', { args: false });
    this.getTriviaCategories().then(categories => this.triviaCategories = categories);
  }
  
  public async execute(message: Message, args: Array<string>, client: Bot): Promise<void> {
    if (args[0] == '--reset' && args.length == 1) {
      const token = client.tokens.get('OTDB');
      if (token) {
        try { return this.resetToken(message, client) }
        catch (error) { this.postErrorMessage(message, error.message) }
      }
      else {
        try { return this.generateNewToken(message, client) }
        catch (error) { this.postErrorMessage(message, error.message) }
      }
    }
    else if (args[0] == '--categories' && args.length == 1) {
      const categories = new Array();
      this.triviaCategories.forEach(category => categories.push(category.name));
      categories.sort();
      const embed = new MessageEmbed()
        .setColor('#0066cc')
        .setTitle('All categories')
        .addField('Here\'s a list of all categories:', categories.slice(0, Math.ceil(categories.length / 2)).join('\n'), true)
        .addField('\u200b', categories.slice(Math.ceil(categories.length / 2), categories.length).join('\n'), true);
      message.channel.send({ embeds: [embed] });
      return;
    }

    let categoryId = -1;
    for (const arg of args) {
      let nameMatches = this.triviaCategories.filter(category => category.name.match(new RegExp(`\\b${arg}\\b`, 'gi')));
      if (!nameMatches.length) nameMatches = this.triviaCategories.filter(category => category.name.match(new RegExp(`\\b${arg}`, 'gi')));
      if (nameMatches.length) {
        const index = Math.floor(Math.random() * nameMatches.length); // Select a random category from the avalible matches
        categoryId = nameMatches[index].id;
        if (nameMatches.length == 1) break; // If we matched to exactly one category we can safely stop searching
      }
    }
    
    let data: TriviaQuestion;
    try {
      data = await this.getQuestion(message, categoryId, client);
    }
    catch (error) {
      this.postErrorMessage(message, error.message);
      return;
    }

    const description = `${data.difficulty == 'easy' ? 'An' : 'A'} ${this.capitalize(data.difficulty)} one from the category ${data.category}.`;
    
    let allAnswers = new Array();
    allAnswers.push(data.correct_answer);
    data.incorrect_answers.forEach((entry: string) => allAnswers.push(entry));
    allAnswers = allAnswers.length == 2 ? allAnswers.sort().reverse() : this.shuffle(allAnswers); // Sort if true/false, shuffle otherwise

    const allEmotes = ['🍎', '🍓', '🍐', '🍒', '🍇', '🥕', '🍊', '🍉', '🍋', '🍌', '🥥', '🥑', '🥦', '🌶️', '🌽', '🥝', '🧄', '🍍', '🥬'];
    const emotes = this.shuffle(allEmotes).slice(0, allAnswers.length);

    const correctEmote = emotes[allAnswers.indexOf(data.correct_answer)];

    let answerString = '';
    allAnswers.forEach((ans, index) => answerString += `${emotes[index]} - ${ans}\n`);

    const embed = new MessageEmbed()
      .setTitle(`${message.member ? message.member.displayName : message.author.username}, here's a question!`) // Respect nicknames on servers
      .setDescription(description)
      .addField('Question', this.cleanup(data.question))
      .addField('Choices', this.cleanup(answerString))
      .setFooter({ text: 'Answer by reacting to the corresponding emote' })
      .setTimestamp();

    // Set embed color depending on difficulty
    switch (data.difficulty) {
      case 'easy':
        embed.setColor('#00cc00');
        break;
      case 'medium':
        embed.setColor('#cc6600');
        break;
      case 'hard':
        embed.setColor('#cc0000');
        break; 
    }

    const triviaMessage = await message.channel.send({ embeds: [embed] });
    emotes.forEach(emote => triviaMessage.react(emote));

    // Compact notation for function
    const filter = (reaction: MessageReaction, user: User) => user.id == message.author.id && emotes.includes(reaction.emoji.name);

    const collector = triviaMessage.createReactionCollector({ filter, max: 1, time: 25000 });
    let reacted = false;
    const embedAns = new MessageEmbed();

    collector.on('collect', reaction => {
      reacted = true;
      if (reaction.emoji.name == correctEmote) {
        embedAns
          .setColor('#00cc00')
          .setTitle('Correct answer!')
          .setDescription(`<@${message.author.id}>, you were correct! Congratulations!`);
      }
      else {
        embedAns
          .setColor('#cc0000')
          .setTitle('Incorrect')
          .setDescription(`Sorry, but that's incorrect. The right answer was ${this.cleanup(data.correct_answer)}.`)
          .setFooter({ text: 'Better luck next time!' });
      }
      return message.channel.send({ embeds: [embedAns] });
    });

    collector.on('end', () => {
      if (reacted) return;
      embedAns
        .setColor('#cc6600')
        .setTitle('Time\'s up!')
        .setDescription(`You ran out of time! The correct answer was ${data.correct_answer}.`);
      return message.channel.send({ embeds: [embedAns] });
    });
  }

  private postErrorMessage(message: Message, errorMessage: string): void {
    const embed = new MessageEmbed()
      .setColor('#cc0000')
      .setTitle('Error')
      .setDescription('An error was encountered')
      .addField('Error message:', `\`${errorMessage}\``);
    message.channel.send({ embeds: [embed] });
  }

  private async getQuestion(message: Message, categoryId: number, client: Bot): Promise <TriviaQuestion> {
    const token = client.tokens.get('OTDB');
    if (token) {
      let URL = 'https://opentdb.com/api.php?amount=1';
      if (categoryId != -1) URL += `&category=${categoryId}`;
      URL += `&token=${token}`;

      const response = await fetch(URL);
      const data = await response.json();
      switch (data.response_code) {
        case 0: return data.results[0];
        case 1: throw new Error(`Could not get question.\nResponse code: ${data.response_code}`);
        case 2: throw new Error(`Invalid argument.\nCategory ID: \`${categoryId}\``);
        case 4: {
          const embed = new MessageEmbed()
            .setColor('#0066cc')
            .setTitle('Empty token')
            .setDescription('Requesting reset...');
          message.channel.send({ embeds: [embed] });

          try { await this.resetToken(message, client) }
          catch (error) { throw error }

          try { return await this.getQuestion(message, categoryId, client) }
          catch (error) { throw error }
        }
        default: // Case 3
      }
    }

    try { await this.generateNewToken(message, client) }
    catch (error) { throw error }

    try { return await this.getQuestion(message, categoryId, client) }
    catch (error) { throw error }
  }

  private async generateNewToken(message: Message, client: Bot): Promise<void> {
    const embed = new MessageEmbed()
      .setColor('#0066cc')
      .setTitle('No stored token found')
      .setDescription('Requesting new token...');
    message.channel.send({ embeds: [embed] });
    
    const response = await fetch('https://opentdb.com/api_token.php?command=request');
    const data = await response.json();

    if (data.response_code == 0) {
      embed
        .setColor('#00cc00')
        .setTitle('Token recieved');
      delete embed.description;
      message.channel.send({ embeds: [embed] });
      client.tokens.set('OTDB', data.token);
    }
    else throw new Error(`Could not generate new token.\nResponse code ${data.response_code}`);
  }

  private async resetToken(message: Message, client: Bot): Promise<void> {
    const token = client.tokens.get('OTDB');
    if (token) {
      const respose = await fetch(`https://opentdb.com/api_token.php?command=reset&token=${token}`);
      const data = await respose.json();
      if (data.response_code == 0) {
        const embed = new MessageEmbed()
          .setColor('#00cc00')
          .setTitle('Token reset');
        message.channel.send({ embeds: [embed] });
      }
      else throw new Error(`Could not reset token.\nResponse code ${data.response_code}`);
    }
    else throw new Error('No token found.');
  }

  private async getTriviaCategories(): Promise<Array<TriviaCategory>> {
    interface ResponseData {
      trivia_categories: Array<TriviaCategory>;
    }

    const response = await fetch('https://opentdb.com/api_category.php');
    const data: ResponseData = await response.json();
    return data.trivia_categories;
  }

  private shuffle(array: Array<string>): Array<string> {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
    return array;
  }

  private capitalize(str: string): string {
    return typeof str == 'string' ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  private cleanup(str: string): string {  
    // Keep on adding to this list as you find more errors
    const allReplacements = [[/&#039;/g, '\''], [/&quot;/g, '\''], [/&micro;/g, 'µ'], [/&Agrave;/g, 'À'], [/&Aacute;/g, 'Á'],
      [/&Acirc;/g, 'Â'], [/&Atilde;/g, 'Ã'], [/&Auml;/g, 'Ä'], [/&Aring;/g, 'Å'], [/&agrave;/g, 'à'], [/&aacute;/g, 'á'],
      [/&acirc;/g, 'â'], [/&atilde;/g, 'ã'], [/&auml;/g, 'ä'], [/&aring;/g, 'å'], [/&AElig;/g, 'Æ'], [/&aelig;/g, 'æ'],
      [/&szlig;/g, 'ß'], [/&Ccedil;/g, 'Ç'], [/&ccedil;/g, 'ç'], [/&Egrave;/g, 'È'], [/&Eacute;/g, 'É'], [/&Ecirc;/g, 'Ê'],
      [/&Euml;/g, 'Ë'], [/&egrave;/g, 'è'], [/&eacute;/g, 'é'], [/&ecirc;/g, 'ê'], [/&euml;/g, 'ë'], [/&#131;/g, 'ƒ'],
      [/&Igrave;/g, 'Ì'], [/&Iacute;/g, 'Í'], [/&Icirc;/g, 'Î'], [/&Iuml;/g, 'Ï'], [/&igrave;/g, 'ì'], [/&iacute;/g, 'í'],
      [/&icirc;/g, 'î'], [/&iuml;/g, 'ï'], [/&Ntilde;/g, 'Ñ'], [/&ntilde;/g, 'ñ'], [/&Ograve;/g, 'Ò'], [/&Oacute;/g, 'Ó'],
      [/&Ocirc;/g, 'Ô'], [/&Otilde;/g, 'Õ'], [/&Ouml;/g, 'Ö'], [/&ograve;/g, 'ò'], [/&oacute;/g, 'ó'], [/&ocirc;/g, 'ô'],
      [/&otilde;/g, 'õ'], [/&ouml;/g, 'ö'], [/&Oslash;/g, 'Ø'], [/&oslash;/g, 'ø'], [/&#140;/g, 'Œ'], [/&#156;/g, 'œ'],
      [/&#138;/g, 'Š'], [/&#154;/g, 'š'], [/&Ugrave;/g, 'Ù'], [/&Uacute;/g, 'Ú'], [/&Ucirc;/g, 'Û'], [/&Uuml;/g, 'Ü'],
      [/&ugrave;/g, 'ù'], [/&uacute;/g, 'ú'], [/&ucirc;/g, 'û'], [/&uuml;/g, 'ü'], [/&#181;/g, 'µ'], [/&Yacute;/g, 'Ý'],
      [/&#159;/g, 'Ÿ'], [/&yacute;/g, 'ý'], [/&yuml;/g, 'ÿ'], [/&deg;/g, '°'], [/&amp;/g, '&'], [/&ldquo;/g, '“'],
      [/&rdquo;/g, '”'], [/&reg;/g, '®'], [/&trade;/g, '™'], [/&lt;/g, '<'], [/&gt;/g, '>'], [/&le;/g, '≤'],
      [/&ge;/g, '≥']];
  
    allReplacements.forEach(pair => str = str.replace(pair[0], pair[1] as string));
    return str;
  }
}

export default Trivia;