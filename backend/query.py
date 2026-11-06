"""Ask a question from the terminal."""
from backend.rag import answer_question


def main() -> None:
    try:
        while True:
            question = input("\nAsk your PDFs (or type 'exit'): ").strip()
            if question.lower() in {"exit", "quit"}:
                break
            if not question:
                continue
            result = answer_question(question)
            print(f"\n{result['answer']}")
            if result["sources"]:
                print("\nSources:")
                for source in result["sources"]:
                    print(f"  [{source['filename']}, p. {source['page']}]  relevance {source['score']:.0%}")
    except (EOFError, KeyboardInterrupt):
        print("\nGoodbye.")


if __name__ == "__main__":
    main()
